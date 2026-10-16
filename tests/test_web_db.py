"""Tests du mandataire web (anti-SSRF) et des bases de données SQLite.

Lancement :  python3 -m unittest discover -s tests
Aucun accès réseau requis : seules des adresses locales/privées sont testées.
"""

import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ["WINWEB_DATA"] = tempfile.mkdtemp(prefix="winweb-test-")

import app as winweb  # noqa: E402
import dbsql  # noqa: E402
import web_proxy  # noqa: E402

H = {"X-WinWeb": "1"}


class ProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = winweb.app.test_client()

    def test_local_and_private_addresses_are_refused(self):
        for url in ["http://127.0.0.1:5000/", "http://localhost/", "http://10.0.0.1/", "http://192.168.1.1/",
                    "http://[::1]/", "http://169.254.169.254/latest/meta-data", "http://0x7f000001/",
                    "http://[::ffff:127.0.0.1]/"]:
            with self.subTest(url=url):
                resp = self.client.get("/web", query_string={"url": url})
                self.assertEqual(resp.status_code, 403)
                self.assertIn("sandbox", resp.headers["Content-Security-Policy"])
                self.assertNotIn("allow-same-origin", resp.headers["Content-Security-Policy"])

    def test_bad_schemes_are_refused(self):
        for url in ["file:///etc/passwd", "ftp://example.com/", "javascript:alert(1)", "http://user:pw@example.com/"]:
            with self.subTest(url=url):
                self.assertEqual(self.client.get("/web", query_string={"url": url}).status_code, 400)

    def test_download_requires_csrf_header(self):
        resp = self.client.post("/api/web/download", json={"url": "http://127.0.0.1/"})
        self.assertEqual(resp.status_code, 403)
        resp = self.client.post("/api/web/download", json={"url": "http://127.0.0.1/"}, headers=H)
        self.assertEqual(resp.status_code, 403)

    def test_rewrite_injects_base_and_script(self):
        out = web_proxy.rewrite_html("<html><head><title>T</title></head><body>x</body></html>", 'https://a.b/c?"d')
        self.assertIn('<base href="https://a.b/c?&quot;d">', out)
        self.assertIn("winweb:navigate", out)
        self.assertLess(out.index("<base"), out.index("<title>"))


class DatabaseTests(unittest.TestCase):
    def setUp(self):
        self.client = winweb.app.test_client()
        self.path = "/Documents/t%d.wdb" % id(self)
        self.client.post("/api/fs/write", json={"path": self.path, "content": ""}, headers=H)

    def run_sql(self, sql, params=None):
        return self.client.post("/api/db/exec", json={"path": self.path, "sql": sql, "params": params}, headers=H)

    def test_crud_and_schema(self):
        resp = self.run_sql("CREATE TABLE p (id INTEGER PRIMARY KEY, nom TEXT); INSERT INTO p (nom) VALUES ('a;b'), ('c');"
                            " SELECT nom FROM p ORDER BY id")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json["results"][-1]["rows"], [["a;b"], ["c"]])
        resp = self.run_sql("SELECT nom FROM p WHERE id = ?", [2])
        self.assertEqual(resp.json["results"][0]["rows"], [["c"]])
        schema = self.client.get("/api/db/schema", query_string={"path": self.path}).json
        self.assertEqual(schema["objects"][0]["name"], "p")
        self.assertEqual(schema["objects"][0]["count"], 2)

    def test_escapes_are_blocked(self):
        target = os.path.join(tempfile.gettempdir(), "winweb-evil.db")
        for sql in ["ATTACH '%s' AS x" % target, "VACUUM INTO '%s'" % target, "PRAGMA writable_schema=1",
                    "SELECT load_extension('x')", "PRAGMA journal_mode=DELETE"]:
            with self.subTest(sql=sql):
                self.assertEqual(self.run_sql(sql).status_code, 400)
        self.assertFalse(os.path.exists(target))

    def test_runaway_query_is_interrupted(self):
        resp = self.run_sql("WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c) SELECT count(*) FROM c")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("interrompue", resp.json["error"])

    def test_only_wdb_files(self):
        resp = self.client.get("/api/db/schema", query_string={"path": "/Documents/Bienvenue.txt"})
        self.assertEqual(resp.status_code, 400)

    def test_split_statements(self):
        self.assertEqual(dbsql.split_statements("SELECT 'a;b'; -- c;\nSELECT 2"), ["SELECT 'a;b';", "-- c;\nSELECT 2;"])


if __name__ == "__main__":
    unittest.main()
