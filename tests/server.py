"""Local static server that applies the same headers as vercel.json (for tests)."""
import http.server, json, os, re, sys, threading, functools

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, "vercel.json"), encoding="utf-8"))

def _rules():
    out = []
    for h in CFG.get("headers", []):
        pat = "^" + h["source"].replace("(.*)", ".*") + "$"
        out.append((re.compile(pat), h["headers"]))
    return out
RULES = _rules()
# Tests use a fixed team config, so the team's live settings never change test results.
FIXTURE_CFG = os.path.join(ROOT, "tests", "fixtures", "team-config.json")

class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def translate_path(self, path):
        if path.split("?")[0] == "/team-config.json" and os.environ.get("LIVE_TEAM_CONFIG") != "1": return FIXTURE_CFG
        return super().translate_path(path)
    def end_headers(self):
        path = self.path.split("?")[0]
        for rx, hs in RULES:
            if rx.match(path):
                for x in hs: self.send_header(x["key"], x["value"])
        super().end_headers()

def start(port=8777):
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv

if __name__ == "__main__":
    start(int(sys.argv[1]) if len(sys.argv) > 1 else 8777); print("serving"); threading.Event().wait()
