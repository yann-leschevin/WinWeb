// Coloration syntaxique légère pour l'éditeur de code.
// Chaque langage = liste de règles [classe, motif] combinées en une seule
// expression régulière ; le texte hors correspondance reste brut.

const kw = (words, flags = '') => new RegExp(`\\b(?:${words.split(' ').join('|')})\\b`, flags);
const NUM = /\b(?:0x[\da-fA-F_]+|0b[01_]+|\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?)\b/;
const DQ = /"(?:[^"\\\n]|\\.)*"?/;
const SQ = /'(?:[^'\\\n]|\\.)*'?/;
const CALL = /\b[A-Za-z_$][\w$]*(?=\s*\()/;
const C_COMMENTS = [['com', /\/\/.*/], ['com', /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/]];

const JS_KW = 'break case catch class const continue debugger default delete do else export extends finally for from function '
  + 'if import in instanceof let new of return static super switch this throw try typeof var void while with yield async await '
  + 'get set interface type enum implements private public protected readonly declare namespace abstract as';
const C_KW = 'auto break case char const continue default do double else enum extern float for goto if inline int long register '
  + 'return short signed sizeof static struct switch typedef union unsigned void volatile while class public private protected '
  + 'virtual override template typename namespace using new delete this throw try catch bool true false nullptr include define '
  + 'import package extends implements interface final abstract boolean byte string var foreach in out ref func go chan defer '
  + 'map range select struct fn let mut impl trait pub use mod match loop where self Self echo function null elseif endif';

export const LANGS = {
  text: { name: 'Texte normal', exts: ['txt', 'log', ''], rules: [] },
  javascript: {
    name: 'JavaScript / TypeScript', exts: ['js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx'], comment: { line: '//', block: ['/*', '*/'] },
    rules: [...C_COMMENTS, ['str', /`(?:[^`\\]|\\[\s\S])*`?/], ['str', DQ], ['str', SQ], ['num', NUM],
      ['kw', kw(JS_KW)], ['lit', kw('true false null undefined NaN Infinity')], ['fn', CALL], ['type', /\b[A-Z][\w$]*\b/]],
  },
  json: {
    name: 'JSON', exts: ['json', 'webmanifest'],
    rules: [['key', /"(?:[^"\\\n]|\\.)*"(?=\s*:)/], ['str', DQ], ['num', /-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/], ['lit', kw('true false null')]],
  },
  python: {
    name: 'Python', exts: ['py', 'pyw'], comment: { line: '#' },
    rules: [['com', /#.*/], ['str', /(?:[rRbBfFuU]{1,2})?(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$))/], ['str', /(?:[rRbBfFuU]{1,2})?(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/],
      ['deco', /@[\w.]+/], ['num', NUM],
      ['kw', kw('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case')],
      ['lit', kw('True False None self cls')], ['fn', CALL], ['type', /\b[A-Z][\w]*\b/]],
  },
  html: {
    name: 'HTML / XML', exts: ['html', 'htm', 'xml', 'svg', 'xhtml', 'vue'], comment: { block: ['<!--', '-->'] },
    rules: [['com', /<!--[\s\S]*?(?:-->|(?![\s\S]))/], ['meta', /<!DOCTYPE[^>]*>|<\?[\s\S]*?\?>/i], ['tag', /<\/?[A-Za-z][\w:.-]*/],
      ['tag', /\/?>/], ['attr', /\b[\w:@.-]+(?=\s*=)/], ['str', /"[^"]*"?|'[^']*'?/], ['ent', /&[#\w]+;/]],
  },
  css: {
    name: 'CSS', exts: ['css', 'scss', 'less'], comment: { block: ['/*', '*/'] },
    rules: [['com', /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/], ['str', DQ], ['str', SQ], ['kw', /@[\w-]+/], ['num', /#[\da-fA-F]{3,8}\b/],
      ['attr', /[\w-]+(?=\s*:(?!:))/], ['num', /-?\b\d+(?:\.\d+)?(?:px|em|rem|%|vh|vw|s|ms|deg|fr|pt|cm|mm)?\b/],
      ['fn', /[\w-]+(?=\()/], ['tag', /[.#][\w-]+/], ['lit', kw('!important inherit initial none auto')]],
  },
  markdown: {
    name: 'Markdown', exts: ['md', 'markdown'],
    rules: [['com', /```[\s\S]*?(?:```|(?![\s\S]))/], ['kw', /^#{1,6} .*$/m], ['str', /`[^`\n]+`/], ['tag', /\*\*[^*\n]+\*\*|__[^_\n]+__/],
      ['attr', /\*[^*\n]+\*|_[^_\n]+_/], ['fn', /!?\[[^\]\n]*\]\([^)\n]*\)/], ['num', /^\s*(?:[-*+]|\d+\.)\s/m], ['deco', /^>.*$/m]],
  },
  c: {
    name: 'C / C++ / Java / C# / Go / Rust / PHP', exts: ['c', 'h', 'cpp', 'hpp', 'cc', 'cxx', 'java', 'cs', 'go', 'rs', 'php', 'kt', 'swift', 'dart'],
    comment: { line: '//', block: ['/*', '*/'] },
    rules: [...C_COMMENTS, ['meta', /^\s*#\s*\w+.*$/m], ['str', DQ], ['str', SQ], ['var', /\$\w+/], ['num', NUM],
      ['kw', kw(C_KW)], ['lit', kw('true false null NULL nil None')], ['fn', CALL], ['type', /\b[A-Z][\w]*\b/]],
  },
  sql: {
    name: 'SQL', exts: ['sql'], comment: { line: '--', block: ['/*', '*/'] },
    rules: [['com', /--.*/], ['com', /\/\*[\s\S]*?(?:\*\/|(?![\s\S]))/], ['str', /'(?:[^']|'')*'?/], ['attr', /"[^"]*"?/], ['num', NUM],
      ['kw', kw('select from where and or not insert into values update set delete create table view index drop alter add column '
        + 'primary key foreign references join left right inner outer full cross on group by order having limit offset as distinct '
        + 'union all case when then else end null is in like between exists default unique check autoincrement begin commit rollback '
        + 'transaction asc desc with recursive replace if integer text real blob numeric date varchar int', 'i')],
      ['fn', CALL]],
  },
  shell: {
    name: 'Shell / Batch / PowerShell', exts: ['sh', 'bash', 'zsh', 'bat', 'cmd', 'ps1'], comment: { line: '#' },
    rules: [['com', /(?:^|\s)#.*|^\s*(?:rem\b|::).*/im], ['str', DQ], ['str', SQ], ['var', /\$\{?[\w@#?*!-]+\}?|%[\w~]+%?/],
      ['kw', kw('if then else elif fi for while do done case esac in function return exit echo set export local cd call goto '
        + 'shift setlocal endlocal not exist errorlevel pause cls dir copy del param foreach', 'i')], ['num', NUM]],
  },
  ini: {
    name: 'INI / TOML / Config', exts: ['ini', 'cfg', 'conf', 'toml', 'properties', 'env'], comment: { line: ';' },
    rules: [['com', /^\s*[;#].*/m], ['tag', /^\s*\[[^\]\n]*\]/m], ['attr', /^\s*[\w.-]+(?=\s*[=:])/m], ['str', DQ], ['str', SQ], ['num', NUM], ['lit', kw('true false yes no on off')]],
  },
  yaml: {
    name: 'YAML', exts: ['yml', 'yaml'], comment: { line: '#' },
    rules: [['com', /#.*/], ['attr', /^\s*-?\s*[\w.-]+(?=\s*:)/m], ['str', DQ], ['str', SQ], ['num', NUM], ['lit', kw('true false null yes no')], ['kw', /^---$/m]],
  },
};

export function langForExt(ext) {
  const e = String(ext || '').toLowerCase();
  for (const [id, lang] of Object.entries(LANGS)) if (lang.exts.includes(e)) return id;
  return 'text';
}

const compiled = new Map();
function compile(id) {
  if (compiled.has(id)) return compiled.get(id);
  const rules = LANGS[id]?.rules || [];
  let flags = 'g';
  if (rules.some(([, re]) => re.flags.includes('i'))) flags += 'i';
  if (rules.some(([, re]) => re.flags.includes('m'))) flags += 'm';
  const re = rules.length ? new RegExp(rules.map(([, r]) => `(${r.source})`).join('|'), flags) : null;
  const out = { re, classes: rules.map(([cls]) => cls) };
  compiled.set(id, out);
  return out;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };
function escapeText(s, ws) {
  let out = s.replace(/[&<>]/g, (c) => ESC[c]);
  if (ws) out = out.replace(/ /g, '<span class="ws-sp"> </span>').replace(/\t/g, '<span class="ws-tab">\t</span>');
  return out;
}

/**
 * Retourne le HTML de chaque ligne (tableau) pour le texte donné.
 * opts : { whitespace: bool } ; au-delà de maxChars, pas de coloration.
 */
export function highlightLines(text, langId, { whitespace = false, maxChars = 300000 } = {}) {
  const lines = [''];
  const push = (chunk, cls) => {
    const parts = chunk.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push('');
      if (!part) return;
      const html = escapeText(part, whitespace);
      lines[lines.length - 1] += cls ? `<span class="hl-${cls}">${html}</span>` : html;
    });
  };
  const { re, classes } = text.length > maxChars ? { re: null } : compile(langId);
  if (!re) {
    push(text, null);
    return lines;
  }
  re.lastIndex = 0;
  let last = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') { re.lastIndex += 1; continue; }
    if (m.index > last) push(text.slice(last, m.index), null);
    let cls = null;
    for (let i = 1; i < m.length; i += 1) {
      if (m[i] !== undefined) { cls = classes[i - 1]; break; }
    }
    push(m[0], cls);
    last = re.lastIndex;
  }
  if (last < text.length) push(text.slice(last), null);
  return lines;
}
