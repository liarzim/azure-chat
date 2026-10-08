"""Updating against a simulated Azure DevOps: checks the exact requests the tool sends."""
import os, sys, json, base64, copy, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:600]))
    if not c: fails.append(n)
META = json.load(open(os.path.join(ROOT, "demo", "meta.json"), encoding="utf-8"))
PAT = "test-pat"; AUTH = "Basic " + base64.b64encode((":" + PAT).encode()).decode()
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}
ME = {"displayName": "מיכאל ליארזי", "uniqueName": "michaelia@GOIFinance.onmicrosoft.com"}
ITEMS = {
 112074: {"id": 112074, "rev": 5, "fields": {"System.WorkItemType": "Bug", "System.Title": "שדות orderNumber לא מתמלאים", "System.State": "Active", "System.TeamProject": "Portfolio Merkava",
   "System.AssignedTo": ME, "System.IterationPath": "Portfolio Merkava\\PI4_26\\4.1", "System.AreaPath": "Portfolio Merkava\\MK2\\Meteor\\Meteor Sigma", "Microsoft.VSTS.Common.ValueArea": "Maintenance",
   "Custom.Relevance": False, "Custom.Reviewed": False, "Custom.EscapingDefect": False, "Custom.CR": False, "Custom.Reopen": False, "Custom.OSS": False, "System.Tags": "SAP",
   "Microsoft.VSTS.TCM.ReproSteps": "<div>אין טיפול בקוד</div>"}, "relations": []},
 110047: {"id": 110047, "rev": 9, "fields": {"System.WorkItemType": "User Story", "System.Title": "תיקונים ותוספות של סאפ", "System.State": "Active", "System.TeamProject": "Portfolio Merkava",
   "System.AssignedTo": {"displayName": "שלומי גבעון", "uniqueName": "shlomigiv@GOIFinance.onmicrosoft.com"}, "System.IterationPath": "Portfolio Merkava\\PI4_26", "System.AreaPath": "Portfolio Merkava\\MK2\\Meteor\\Meteor Sigma",
   "Microsoft.VSTS.Common.ValueArea": "Business", "Custom.CR": False, "Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7": False, "Custom.Deliveryrisk": False, "System.Tags": "SAP; Q4", "Custom.Customer": "מימון ואשראי"}, "relations": []},
}
log = {"patch": [], "auth_bad": 0, "picker": 0}
behaviour = {"conflict": set(), "rule": set()}
def handler(route, req):
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    h = req.all_headers(); u = req.url
    if h.get("authorization") != AUTH: log["auth_bad"] += 1; return route.fulfill(status=203, body="<html>sign in</html>", headers={**CORS, "content-type": "text/html"})
    J = lambda d, s=200: route.fulfill(status=s, json=d, headers=CORS)
    if "/_apis/projects?" in u: return J({"value": [{"name": "Portfolio Merkava"}]})
    if "/_apis/connectionData" in u: return J({"authenticatedUser": {"providerDisplayName": ME["displayName"], "properties": {"Account": {"$type": "System.String", "$value": ME["uniqueName"]}}}})
    if "/IdentityPicker/Identities" in u:
        log["picker"] += 1; q = json.loads(req.post_data)["query"]
        people = [{"displayName": "חיה נשר", "signInAddress": "Chayane@GOIFinance.onmicrosoft.com"}, {"displayName": "חיים כהן", "signInAddress": "chaimc@GOIFinance.onmicrosoft.com"}]
        return J({"results": [{"identities": [p for p in people if q in p["displayName"]]}]})
    if "/_apis/wit/fields?" in u: return J({"value": META["fields"]})
    if "/classificationnodes?" in u: return J({"value": META["classificationnodes"]})
    m = re.search(r"/workitemtypes/([^/?]+)/fields\?", u)
    if m: return J({"value": META["typeFields"][requests_unquote(m.group(1))]})
    if re.search(r"/_apis/wit/workitemtypes\?", u): return J({"value": META["workitemtypes"]})
    if re.search(r"/work/processes/[^/]+/workitemtypes\?", u): return J({"value": META["processWits"]})
    m = re.search(r"/workItemTypes/([^/?]+)/layout\?", u)
    if m: return J(META["layouts"][next(w["name"] for w in META["processWits"] if w["referenceName"] == m.group(1))])
    m = re.search(r"/_apis/wit/workitems\?ids=([\d,]+)", u)
    if m and req.method == "GET": return J({"value": [copy.deepcopy(ITEMS.get(int(i))) for i in m.group(1).split(",")]})
    m = re.search(r"/_apis/wit/workitems/(\d+)\?", u)
    if m and req.method == "PATCH":
        wid = int(m.group(1)); ops = json.loads(req.post_data); log["patch"].append({"id": wid, "ops": ops, "ct": h.get("content-type"), "url": u})
        if wid in behaviour["conflict"]: return J({"message": "TF26071: This work item has been changed by someone else since you opened it. You will need to refresh it and discard your changes."}, 412)
        if wid in behaviour["rule"]: return J({"message": "TF401320: Rule Error for field Severity. Error code: Required, InvalidEmpty."}, 400)
        it = ITEMS[wid]
        assert ops[0] == {"op": "test", "path": "/rev", "value": it["rev"]}
        for o in ops[1:]:
            ref = o["path"].replace("/fields/", "")
            if ref == "System.History": continue
            if o["op"] == "remove": it["fields"].pop(ref, None)
            else:
                v = o["value"]
                if ref == "System.AssignedTo":
                    mm = re.match(r"^(.*?)\s*<([^>]+)>$", v); v = {"displayName": mm.group(1), "uniqueName": mm.group(2)} if mm else {"displayName": v, "uniqueName": v}
                it["fields"][ref] = v
        it["rev"] += 1
        return J(copy.deepcopy(it))
    return J({"message": "not mocked " + u}, 404)
from urllib.parse import unquote as requests_unquote
srv = start(8782)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900})
    ctx.route("https://dev.azure.com/**", handler)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8782/"); pg.fill("#pat", PAT); pg.click("#patBtn"); pg.locator("#app:not(.hidden)").wait_for()
    send = lambda t: (pg.fill("#input", t), pg.keyboard.press("Enter"))
    send("112074, 110047"); pg.locator(".msg.bot table").first.wait_for()
    hdr = [h.inner_text() for h in pg.locator(".msg.bot table").first.locator("th").all()]
    # a. panel: state + comment
    pg.locator(".msg.bot table").first.locator("tbody tr").nth(0).locator("td").nth(hdr.index("State")).click()
    pg.locator("#editPanel:not(.hidden)").wait_for()
    pg.locator("#epFields select[aria-label='State']").select_option("Resolved")
    pg.fill("#epComment", "תוקן בגרסה 4.1\nנבדק"); pg.wait_for_timeout(300)
    pg.click("#epSave"); pg.locator(".msg.bot.ok").first.wait_for()
    pt = log["patch"][-1]
    check("PATCH content type", pt["ct"] == "application/json-patch+json", pt["ct"])
    check("rev test first", pt["ops"][0] == {"op": "test", "path": "/rev", "value": 5}, pt["ops"])
    check("state op", {"op": "add", "path": "/fields/System.State", "value": "Resolved"} in pt["ops"], pt["ops"])
    check("comment as History html", any(o["path"] == "/fields/System.History" and o["value"] == "<div>תוקן בגרסה 4.1</div><div>נבדק</div>" for o in pt["ops"]), pt["ops"])
    check("only the changed field sent", len(pt["ops"]) == 3, pt["ops"])
    check("expand=all on PATCH", "$expand=all" in pt["url"])
    check("table shows new state", pg.locator(".msg.bot table").first.locator("tbody tr").nth(0).locator("td").nth(hdr.index("State")).inner_text() == "Resolved")
    # b. assign via identity search
    send("112074 שייך לחי"); pg.locator(".editcard").nth(0).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("identity search used and ambiguous names listed", log["picker"] >= 1 and "חיה נשר" in t and "חיים כהן" in t, t)
    pg.locator(".editcard").last.locator("button:has-text('ביטול')").click()
    send("112074 שייך לחיה נשר"); pg.locator(".editcard").nth(1).wait_for()
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('עודכנו')").wait_for()
    pt = log["patch"][-1]
    check("assigned to as 'Name <email>'", {"op": "add", "path": "/fields/System.AssignedTo", "value": "חיה נשר <Chayane@GOIFinance.onmicrosoft.com>"} in pt["ops"], pt["ops"])
    check("rev advanced", pt["ops"][0]["value"] == 6, pt["ops"][0])
    # c. clearing a field → remove op; tags add/remove
    send("110047 Tags -Q4; Customer ריק"); pg.locator(".editcard").nth(2).wait_for()
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('עודכנו')").wait_for()
    pt = log["patch"][-1]
    check("tags edited", {"op": "add", "path": "/fields/System.Tags", "value": "SAP"} in pt["ops"], pt["ops"])
    check("cleared field removed", {"op": "remove", "path": "/fields/Custom.Customer"} in pt["ops"], pt["ops"])
    # d. iteration by short name
    send("110047 112074 Iteration 4.2"); pg.locator(".editcard").nth(3).wait_for()
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('עודכנו 2')").wait_for()
    check("iteration full path sent", all({"op": "add", "path": "/fields/System.IterationPath", "value": "Portfolio Merkava\\PI4_26\\4.2"} in x["ops"] for x in log["patch"][-2:]), log["patch"][-2:])
    # e. conflict
    behaviour["conflict"].add(112074)
    send("112074 Priority 1"); pg.locator(".editcard").nth(4).wait_for()
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('לא עודכנו')").wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("conflict reported per item", "עודכן בינתיים" in t, t)
    behaviour["conflict"].clear()
    # f. Azure rule error message passed through
    behaviour["rule"].add(110047)
    send("110047 Priority 1"); pg.locator(".editcard").nth(5).wait_for()
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('לא עודכנו')").wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("rule error shown without TF code", "Rule Error for field Severity" in t and "TF401320" not in t, t)
    behaviour["rule"].clear()
    # g. "me" resolves from login identity
    send("110047 Assigned To אני"); pg.locator(".editcard").nth(6).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("me = logged-in user", "מיכאל ליארזי" in t, t)
    check("token always sent", log["auth_bad"] == 0, log["auth_bad"])
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
