"""People picker (Assigned To) and tree pickers (Area / Iteration), demo + mocked Azure DevOps."""
import os, sys, json, re, base64
from urllib.parse import unquote
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:600]))
    if not c: fails.append(n)
shot = lambda pg, n: pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", n))
os.makedirs(os.path.join(ROOT, "tests", "artifacts"), exist_ok=True)
srv = start(8787)

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900})
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8787/"); pg.click("#demoBtn")
    # edit an existing item: Assigned To + Iteration pickers
    pg.fill("#input", "110047"); pg.keyboard.press("Enter"); pg.locator(".msg.bot table").first.wait_for()
    pg.locator(".rowedit").first.click(); pg.locator("#editPanel:not(.hidden)").wait_for(); pg.wait_for_timeout(500)
    for ref in ("System.AssignedTo", "System.IterationPath", "System.AreaPath"): pg.select_option("#epAdd", ref); pg.wait_for_timeout(150)
    who = pg.locator("#epFields .pk-input[aria-label='Assigned To']")
    check("assigned-to is a combobox", who.count() == 1 and who.get_attribute("role") == "combobox", pg.inner_html("#epFields")[:400])
    who.click(); pg.locator("#epFields .pk-panel .pk-opt").first.wait_for()
    n = pg.locator("#epFields .pk-panel:not(.hidden) .pk-opt").count()
    check("people list shows everyone", n >= 8, n)
    check("'me' first", pg.locator("#epFields .pk-panel:not(.hidden) .pk-opt").first.inner_text().startswith("אני"))
    shot(pg, "picker_people.png")
    who.fill("מאיה"); pg.wait_for_timeout(300)
    opts = pg.locator("#epFields .pk-panel:not(.hidden) .pk-opt")
    check("filter narrows list", opts.count() == 1 and "מאיה פרץ" in opts.first.inner_text(), opts.count())
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    check("enter selects", who.input_value() == "מאיה פרץ" and pg.locator("#epFields .pk-panel:not(.hidden)").count() == 0)
    who.fill("שם שלא קיים"); pg.click("#epTitle"); pg.wait_for_timeout(400)
    check("free text not in list is flagged", "invalid" in (who.get_attribute("class") or "") and "בחרו אדם" in pg.inner_text("#epFields"))
    check("invalid person blocks save", pg.locator("#epSave").is_disabled(), pg.inner_text("#epSave"))
    who.click(); who.fill("יוסי"); pg.wait_for_timeout(300)
    pg.locator("#epFields .pk-panel:not(.hidden) .pk-opt").first.dispatch_event("mousedown"); pg.wait_for_timeout(200)
    check("click selects", who.input_value() == "יוסי לוי" and "invalid" not in (who.get_attribute("class") or ""))
    # iteration tree
    it = pg.locator("#epFields .pk-btn[aria-label='Iteration']")
    check("iteration shown as button with leaf + path", it.count() == 1 and "›" in it.inner_text(), it.inner_text() if it.count() else "none")
    it.click(); pg.locator("#epFields .pk-tree li").first.wait_for()
    check("tree has root and expands to current value", pg.locator("#epFields .pk-node.sel").count() == 1, pg.inner_text("#epFields .pk-tree"))
    check("iteration dates shown", re.search(r"\d\d/\d\d/\d{4}", pg.inner_text("#epFields .pk-tree")) is not None, pg.inner_text("#epFields .pk-tree")[:300])
    shot(pg, "picker_tree.png")
    node = pg.locator("#epFields .pk-node", has=pg.locator(".pk-name", has_text=re.compile(r"^PI3_26"))).first
    if node.locator(".pk-tg").inner_text() == "◂": node.locator(".pk-tg").click(); pg.wait_for_timeout(200)
    pg.locator("#epFields .pk-name", has_text=re.compile(r"^3\.2")).first.click(); pg.wait_for_timeout(300)
    check("picking a node sets full path", it.locator("b").inner_text() == "3.2" and "PI3_26 › 3.2" in it.inner_text(), it.inner_text())
    # search in the area tree
    ar = pg.locator("#epFields .pk-btn[aria-label='Area']")
    if ar.count():
        ar.click(); pg.locator("#epFields .pk-panel:not(.hidden) .pk-search").wait_for(); pg.fill("#epFields .pk-panel:not(.hidden) .pk-search", "Sigma"); pg.wait_for_timeout(300)
        names = pg.locator("#epFields .pk-panel:not(.hidden) .pk-tree .pk-name").all_inner_texts()
        check("tree search filters and opens", any("Sigma" in x for x in names) and len(names) < 30, names)
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
        check("escape closes tree only", pg.locator("#epFields .pk-panel:not(.hidden)").count() == 0 and pg.locator("#editPanel:not(.hidden)").count() == 1)
    pg.click("#epSave"); pg.locator(".editcard, .msg.bot.ok").last.wait_for(); pg.wait_for_timeout(300)
    vals = pg.evaluate("() => { const f = DemoDB.get(110047).fields; return [f['System.IterationPath'], (f['System.AssignedTo']||{}).uniqueName || f['System.AssignedTo']]; }")
    if vals[0] != "Portfolio Merkava\\PI3_26\\3.2":
        btns = pg.locator("button:has-text('אישור'), button:has-text('שמירה')")
        if btns.count(): btns.last.click(); pg.wait_for_timeout(600)
        vals = pg.evaluate("() => { const f = DemoDB.get(110047).fields; return [f['System.IterationPath'], (f['System.AssignedTo']||{}).uniqueName || f['System.AssignedTo']]; }")
    check("saved path and person", vals[0] == "Portfolio Merkava\\PI3_26\\3.2" and vals[1] == "yossi@example.com", vals)
    check("no js errors", not errs, errs)
    b.close()

# ---- mocked Azure DevOps: teams list, and fallback when teams are forbidden
META = json.load(open(os.path.join(ROOT, "demo", "meta.json"), encoding="utf-8"))
PAT = "test-pat"; AUTH = "Basic " + base64.b64encode((":" + PAT).encode()).decode()
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}
ITEM = {"id": 110047, "rev": 3, "url": "https://dev.azure.com/GOI-Finance/x/_apis/wit/workItems/110047", "fields": {"System.WorkItemType": "User Story", "System.Title": "סיפור", "System.State": "New", "System.TeamProject": "Portfolio Merkava", "System.AreaPath": "Portfolio Merkava\\MK2\\Meteor\\Meteor Sigma", "System.IterationPath": "Portfolio Merkava\\PI4_26\\4.1"}, "relations": []}
mode = {"teams": True}; calls = []
def handler(route, req):
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    u = req.url; J = lambda d, s=200: route.fulfill(status=s, json=d, headers=CORS)
    if req.all_headers().get("authorization") != AUTH: return route.fulfill(status=203, body="x", headers={**CORS, "content-type": "text/html"})
    if "/teams" in u or "/wiql" in u or "fields=System.AssignedTo" in u: calls.append(u)
    if "/_apis/projects?" in u: return J({"value": []})
    if "/_apis/connectionData" in u: return J({"authenticatedUser": {"providerDisplayName": "מיכאל", "properties": {"Account": {"$value": "m@x.com"}}}})
    if re.search(r"/teams/[^/]+/members", u): return J({"value": [{"identity": {"displayName": "צוות " + u.split("/teams/")[1][:2], "uniqueName": "t" + u.split("/teams/")[1][:2] + "@x.com"}}, {"identity": {"displayName": "קבוצה", "uniqueName": "[x]\\grp", "isContainer": True}}]})
    if "/teams?" in u:
        return J({"value": [{"id": "a1", "name": "A"}, {"id": "b2", "name": "B"}]}) if mode["teams"] else J({"message": "TF401027"}, 401)
    if "/wiql?" in u: return J({"workItems": [{"id": 1}, {"id": 2}]})
    if "fields=System.AssignedTo" in u: return J({"value": [{"id": 1, "fields": {"System.AssignedTo": {"displayName": "רונית אחרונה", "uniqueName": "ronit@x.com"}}}, {"id": 2, "fields": {"System.ChangedBy": {"displayName": "עמית", "uniqueName": "amit@x.com"}}}]})
    if "/_apis/wit/fields?" in u: return J({"value": META["fields"]})
    if "/classificationnodes?" in u: return J({"value": META["classificationnodes"]})
    m = re.search(r"/workitemtypes/([^/?]+)/fields\?", u)
    if m: return J({"value": META["typeFields"][unquote(m.group(1))]})
    if re.search(r"/_apis/wit/workitemtypes\?", u): return J({"value": META["workitemtypes"]})
    if re.search(r"/work/processes/[^/]+/workitemtypes\?", u): return J({"value": META["processWits"]})
    m = re.search(r"/workItemTypes/([^/?]+)/layout\?", u)
    if m: return J(META["layouts"][next(w["name"] for w in META["processWits"] if w["referenceName"] == m.group(1))])
    if re.search(r"/_apis/wit/workitems\?ids=110047", u): return J({"value": [ITEM]})
    return J({"message": "not mocked " + u}, 404)

def run_api(teams_ok):
    mode["teams"] = teams_ok; calls.clear()
    with sync_playwright() as p:
        b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900}); ctx.route("https://dev.azure.com/**", handler)
        pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto("http://127.0.0.1:8787/"); pg.fill("#pat", PAT); pg.click("#patBtn"); pg.locator("#app:not(.hidden)").wait_for()
        pg.fill("#input", "110047"); pg.keyboard.press("Enter"); pg.locator(".msg.bot table").first.wait_for()
        pg.locator(".rowedit").first.click(); pg.locator("#editPanel:not(.hidden)").wait_for(); pg.wait_for_timeout(500)
        pg.select_option("#epAdd", "System.AssignedTo"); pg.wait_for_timeout(150)
        who = pg.locator("#epFields .pk-input[aria-label='Assigned To']"); who.click()
        pg.locator("#epFields .pk-panel:not(.hidden) .pk-opt").nth(1).wait_for(); pg.wait_for_timeout(300)
        txt = pg.inner_text("#epFields .pk-panel:not(.hidden)")
        cached = pg.evaluate("() => JSON.parse(localStorage.getItem('ado_people_v1')||'null')")
        b.close()
        return txt, cached, list(calls), errs

txt, cached, c, errs = run_api(True)
check("api: people from team members", "צוות a1" in txt and "צוות b2" in txt and "קבוצה" not in txt, txt)
check("api: no fallback when teams work", not any("/wiql" in x for x in c) and "90" not in txt, c)
check("api: list cached", cached and cached["source"] == "teams" and len(cached["list"]) == 2, cached)
check("api: no js errors (teams)", not errs, errs)
txt, cached, c, errs = run_api(False)
check("api: fallback to recent people", "רונית אחרונה" in txt and "עמית" in txt and any("/wiql" in x for x in c), txt)
check("api: fallback explains token scope", "Project and Team" in txt, txt)
check("api: no js errors (fallback)", not errs, errs)
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
