"""Mandataire (proxy) HTTP minimal pour l'application « Navigateur web ».

La plupart des sites refusent d'être affichés dans une iframe (X-Frame-Options,
CSP frame-ancestors). Le serveur récupère donc la page lui-même, y ajoute une
balise ``<base>`` et un petit script qui renvoie les clics de liens au
navigateur WinWeb, puis la sert avec ``Content-Security-Policy: sandbox`` :
la page s'exécute dans une origine opaque, sans accès à l'API.

Protection SSRF : seules les adresses IP publiques (``is_global``) sont
joignables. La vérification se fait au moment de la connexion, sur l'adresse
réellement utilisée, ce qui couvre les redirections et le « DNS rebinding ».
Bibliothèque standard uniquement.
"""

import html
import http.client
import ipaddress
import re
import socket
import urllib.error
import urllib.parse
import urllib.request

MAX_BYTES = 8 * 1024 * 1024
TIMEOUT = 12
MAX_REDIRECTS = 6
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/124.0 Safari/537.36 WinWeb/1.1")


class ProxyError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.message = message
        self.status = status


# --------------------------------------------------------------------------- validation
def check_url(url):
    """Valide une URL http(s) et la retourne normalisée."""
    if not isinstance(url, str) or len(url) > 4096:
        raise ProxyError("Adresse invalide", 400)
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        raise ProxyError("Seules les adresses http:// et https:// sont prises en charge", 400)
    if not parts.hostname:
        raise ProxyError("Adresse sans nom d'hôte", 400)
    if parts.username or parts.password:
        raise ProxyError("Les identifiants dans l'adresse ne sont pas autorisés", 400)
    return urllib.parse.urlunsplit(parts)


def _public_ip(ip_text):
    ip = ipaddress.ip_address(ip_text.split("%")[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return ip.is_global and not ip.is_multicast


def _safe_create_connection(address, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, source_address=None, **_kw):
    """Remplace socket.create_connection : refuse toute adresse non publique."""
    host, port = address
    try:
        infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    except socket.gaierror as exc:
        raise ProxyError("Nom d'hôte introuvable : %s" % host) from exc
    last_error = None
    for family, socktype, proto, _canon, sockaddr in infos:
        if not _public_ip(sockaddr[0]):
            last_error = ProxyError("Accès refusé : %s désigne une adresse locale ou privée" % host, 403)
            continue
        sock = socket.socket(family, socktype, proto)
        try:
            if timeout is not socket._GLOBAL_DEFAULT_TIMEOUT:
                sock.settimeout(timeout)
            if source_address:
                sock.bind(source_address)
            sock.connect(sockaddr)
            return sock
        except OSError as exc:
            sock.close()
            last_error = exc
    if isinstance(last_error, ProxyError):
        raise last_error
    raise ProxyError("Connexion impossible à %s" % host) from last_error


class _SafeHTTPConnection(http.client.HTTPConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = _safe_create_connection


class _SafeHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._create_connection = _safe_create_connection


class _SafeHTTPHandler(urllib.request.HTTPHandler):
    def http_open(self, req):
        return self.do_open(_SafeHTTPConnection, req)


class _SafeHTTPSHandler(urllib.request.HTTPSHandler):
    def https_open(self, req):
        return self.do_open(_SafeHTTPSConnection, req, context=self._context)


class _RedirectHandler(urllib.request.HTTPRedirectHandler):
    max_redirections = MAX_REDIRECTS

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        check_url(newurl)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(
    urllib.request.ProxyHandler({}),  # ignore http_proxy & co : connexion directe uniquement
    _SafeHTTPHandler, _SafeHTTPSHandler, _RedirectHandler,
)


# --------------------------------------------------------------------------- récupération
def fetch(url, max_bytes=MAX_BYTES):
    """Retourne (url_finale, content_type, charset, corps_bytes)."""
    url = check_url(url)
    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.6",
        "Accept-Encoding": "identity",
    })
    try:
        with _opener.open(req, timeout=TIMEOUT) as resp:
            data = resp.read(max_bytes + 1)
            final = resp.geturl()
            ctype = resp.headers.get_content_type()
            charset = resp.headers.get_content_charset()
    except ProxyError:
        raise
    except urllib.error.HTTPError as exc:
        # Les pages d'erreur (404...) sont tout de même affichées.
        data = exc.read(max_bytes + 1) if exc.fp else b""
        final = exc.geturl() or url
        ctype = exc.headers.get_content_type() if exc.headers else "text/html"
        charset = exc.headers.get_content_charset() if exc.headers else None
        if not data:
            raise ProxyError("Le serveur a répondu %d %s" % (exc.code, exc.reason)) from exc
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, ProxyError):
            raise reason from exc
        raise ProxyError("Site inaccessible : %s" % reason) from exc
    except (OSError, http.client.HTTPException, ValueError) as exc:
        raise ProxyError("Site inaccessible : %s" % exc) from exc
    if len(data) > max_bytes:
        raise ProxyError("Page trop volumineuse (plus de %d Mo)" % (max_bytes // (1024 * 1024)), 413)
    return final, ctype, charset, data


# --------------------------------------------------------------------------- réécriture HTML
_META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9_\-:.]+)""", re.I)
_HEAD_OPEN = re.compile(r"<head(\s[^>]*)?>", re.I)
_HTML_OPEN = re.compile(r"<html(\s[^>]*)?>", re.I)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)

# Script injecté dans chaque page servie par le mandataire : il intercepte la
# navigation (liens, formulaires GET, window.open) et la confie au navigateur
# WinWeb parent par postMessage, pour que l'adresse et l'historique suivent.
NAV_SCRIPT = """<script>(function(){
// Origine opaque : cookies et stockage lèvent SecurityError. On fournit des
// équivalents en mémoire pour que les scripts des sites ne plantent pas.
function mem(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null;},
setItem:function(k,v){d[k]=String(v);},removeItem:function(k){delete d[k];},clear:function(){d={};},
key:function(i){return Object.keys(d)[i]||null;},get length(){return Object.keys(d).length;}};}
try{Object.defineProperty(document,'cookie',{get:function(){return '';},set:function(){},configurable:true});}catch(e){}
['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;}catch(e){try{Object.defineProperty(window,n,{value:mem(),configurable:true});}catch(x){}}});
var P=window.parent;if(!P||P===window)return;
function send(u){try{P.postMessage({type:'winweb:navigate',url:String(u)},'*');}catch(e){}}
document.addEventListener('click',function(e){
 if(e.defaultPrevented||e.button!==0)return;
 var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;if(!a)return;
 var h=a.getAttribute('href')||'';if(!h||h.charAt(0)==='#'||/^\\s*javascript:/i.test(h))return;
 if(a.hasAttribute('download'))return;
 e.preventDefault();send(a.href);
},false);
document.addEventListener('submit',function(e){
 var f=e.target;if(!f||(f.method||'get').toLowerCase()!=='get')return;
 e.preventDefault();
 try{var u=new URL(f.action||document.baseURI);var fd=new FormData(f);
 if(e.submitter&&e.submitter.name)fd.append(e.submitter.name,e.submitter.value);
 u.search=new URLSearchParams(fd).toString();send(u.href);}catch(x){}
},false);
window.open=function(u){if(u)send(new URL(u,document.baseURI).href);return null;};
function refresh(){var m=document.querySelector('meta[http-equiv="refresh" i]');if(!m)return;
 var r=/url\\s*=\\s*['"]?([^'"]+)/i.exec(m.getAttribute('content')||'');if(r)send(new URL(r[1].trim(),document.baseURI).href);}
document.addEventListener('DOMContentLoaded',refresh);
function title(){try{P.postMessage({type:'winweb:title',title:document.title||'',url:document.baseURI},'*');}catch(e){}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',title);else title();
window.addEventListener('load',title);
})();</script>"""


def _decode(data, charset):
    candidates = []
    if charset:
        candidates.append(charset)
    meta = _META_CHARSET.search(data[:4096])
    if meta:
        candidates.append(meta.group(1).decode("ascii", "ignore"))
    candidates += ["utf-8", "windows-1252"]
    for enc in candidates:
        try:
            return data.decode(enc)
        except (LookupError, UnicodeDecodeError):
            continue
    return data.decode("utf-8", "replace")


def rewrite_html(text, base_url):
    """Injecte <base>, la politique de référent et le script de navigation."""
    inject = ('<meta charset="utf-8"><base href="%s"><meta name="referrer" content="no-referrer">%s'
              % (html.escape(base_url, quote=True), NAV_SCRIPT))
    match = _HEAD_OPEN.search(text) or _HTML_OPEN.search(text)
    if match:
        return text[:match.end()] + inject + text[match.end():]
    return inject + text


def page_title(text):
    match = _TITLE.search(text[:200000])
    return html.unescape(match.group(1)).strip()[:200] if match else ""


def proxied_page(url):
    """Retourne (url_finale, content_type, corps_bytes) prêt à servir."""
    final, ctype, charset, data = fetch(url)
    if ctype in ("text/html", "application/xhtml+xml"):
        text = rewrite_html(_decode(data, charset), final)
        return final, "text/html; charset=utf-8", text.encode("utf-8")
    if ctype.startswith("text/") and charset:
        ctype = "%s; charset=%s" % (ctype, charset)
    return final, ctype, data


def filename_for(url, ctype):
    """Nom de fichier raisonnable pour un téléchargement."""
    path = urllib.parse.urlsplit(url).path
    name = urllib.parse.unquote(path.rstrip("/").rsplit("/", 1)[-1]) if path else ""
    if not name:
        name = urllib.parse.urlsplit(url).hostname or "page"
    if "." not in name:
        ext = {"text/html": ".html", "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg",
               "image/gif": ".gif", "image/svg+xml": ".svg", "text/plain": ".txt", "application/json": ".json",
               "application/zip": ".zip"}.get(ctype, "")
        name += ext
    return name[:150]
