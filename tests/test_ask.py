"""Ask Azuri: free questions become queries (chips, defaults, WIQL), dictionary settings."""
import os, sys, json, base64, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT, is_teams, teams_body
from playwright.sync_api import sync_playwright
from urllib.parse import unquote
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:600]))
    if not c: fails.append(n)
META = json.load(open(os.path.join(ROOT, "demo", "meta.json"), encoding="utf-8"))
PAT = "test-pat"; AUTH = "Basic " + base64.b64encode((":" + PAT).encode()).decode()
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}
def item(i, title, squad="Logistics"):
    return {"id": i, "rev": 1, "fields": {"System.WorkItemType": "Bug", "System.Title": title, "System.State": "Active", "System.TeamProject": "Portfolio Merkava",
            "System.AreaPath": "Portfolio Merkava\\MK2\\LOG", "Custom.LeadingSquad": squad, "System.IterationPath": "Portfolio Merkava\\PI4_26\\4.1"}, "relations": []}
ITEMS = {700: item(700, "ממשק לספק"), 701: item(701, "API לדוחות")}
WIQL = []; MODE = {"fulltext": True}
def handler(route, req):
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    u = req.url
    if req.headers.get("authorization") != AUTH: return route.fulfill(status=203, body="<html></html>", headers={**CORS, "content-type": "text/html"})
    J = lambda d, s=200: route.fulfill(status=s, json=d, headers=CORS)
    if "/_apis/projects?" in u: return J({"value": [{"name": "Portfolio Merkava"}]})
    if "/_apis/connectionData" in u: return J({"authenticatedUser": {"providerDisplayName": "בודק", "properties": {"Account": {"$value": "tester@gov.example"}}}})
    if is_teams(u): return J(teams_body(u))
    if "/_apis/wit/fields?" in u: return J({"value": META["fields"]})
    if "/classificationnodes?" in u: return J({"value": META["classificationnodes"]})
    m = re.search(r"/workitemtypes/([^/?]+)/fields\?", u)
    if m: return J({"value": META["typeFields"][unquote(m.group(1))]})
    if re.search(r"/_apis/wit/workitemtypes\?", u): return J({"value": META["workitemtypes"]})
    if re.search(r"/work/processes/[^/]+/workitemtypes\?", u): return J({"value": META["processWits"]})
    m = re.search(r"/workItemTypes/([^/?]+)/layout\?", u)
    if m: return J(META["layouts"][next(w["name"] for w in META["processWits"] if w["referenceName"] == m.group(1))])
    if "/_apis/wit/wiql" in u:
        q = json.loads(req.post_data)["query"]; WIQL.append({"q": q, "url": u})
        if "CONTAINS WORDS" in q and not MODE["fulltext"]: return J({"message": "TF51005: full-text search is not available"}, 400)
        if "Custom.LeadingSquad" in q and "Logistics" in q: return J({"workItems": [{"id": 700}, {"id": 701}]})
        return J({"workItems": []})
    if "/members?" in u or "/teams?" in u: return J({"value": []})
    m = re.search(r"/_apis/wit/workitems\?ids=([\d,]+)", u)
    if m: return J({"value": [ITEMS.get(int(i)) for i in m.group(1).split(",")]})
    return J({"message": "not mocked " + u}, 404)
srv = start(8824)
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1300, "height": 900}); pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8824/"); pg.click("#demoBtn"); pg.wait_for_timeout(300)
    pg.evaluate("Ask.today = '2026-10-20'; 0")
    send = lambda t: (pg.fill("#input", t), pg.keyboard.press("Enter"), pg.wait_for_timeout(700))
    chips = lambda: [x.replace("✕", "").strip() for x in pg.locator(".msg.ask").last.locator(".ask-chip").all_inner_texts()]
    # 1. my items: chips with defaults
    pg.click("#chips button:has-text('מה המשימות שלי')"); pg.wait_for_timeout(700)
    q = pg.locator(".msg.ask").last.locator(".ask-q")
    check("'משימות' is unclear: a guiding question, run waits for the answer", q.count() == 1 and "למה הכוונה" in q.inner_text() and pg.locator(".msg.ask").last.locator("button:has-text('הרצה')").is_disabled())
    check("the options: Feature, User Story, Task, all", [x.strip() for x in q.locator("button").all_inner_texts()] == ["Feature", "User Story", "Task", "הכל (כל הסוגים)"])
    q.locator("button:has-text('Task')").click(); pg.wait_for_timeout(400)
    check("quick question: chips with what was understood", chips() == ["Task", "שויך אליי", "פתוחים", "PI נוכחי (PI4_26)"], chips())
    pg.locator(".msg.ask").last.locator(".ask-chip", has_text="Task").locator("button").click(); pg.wait_for_timeout(300)
    check("removing a chip", "Task" not in chips() and "שויך אליי" in chips(), chips())
    pg.locator(".msg.ask").last.locator("button:has-text('הרצה')").click(); pg.wait_for_timeout(1200)
    tbl = pg.locator(".msg.bot table").last
    ids = [x.replace("✎", "").replace("🔒", "").strip() for x in tbl.locator("tbody tr td:first-child").all_inner_texts()]
    check("run: my open items of the current PI in the usual table", ids and all(int(i) % 7 == 0 for i in ids), ids)
    check("result count shown", "נמצאו " + str(len(ids)) + " פריטים" in pg.locator(".msg.ask").last.inner_text())
    # 1b. a squad name that is not known: which squad?
    send("מה המשימות של סקוואד זוהר")
    m = pg.locator(".msg.ask").last
    m.locator(".ask-q", has_text="למה הכוונה").locator("button:has-text('הכל')").click(); pg.wait_for_timeout(300)
    check("unknown squad name: guiding question with the squads list", "לאיזה סקוואד" in m.inner_text() and m.locator(".ask-q select option").count() > 5)
    m.locator(".ask-q select").select_option("Meteor"); pg.wait_for_timeout(400)
    check("chosen squad becomes a chip, no type limit after 'all'", chips()[0] == "Squad: Meteor" and not any(x in chips() for x in ["Task", "Feature"]), chips())
    check("offer to add the name to the dictionary", m.locator("button:has-text('בקשה להוסיף \"זוהר\" = Meteor')").count() == 1)
    send("באגים של סקוואד זוהר")
    m = pg.locator(".msg.ask").last
    m.locator("button:has-text('זה לא סקוואד')").click(); pg.wait_for_timeout(300)
    check("not a squad: searched as a word", any(x.startswith("מילים: זוהר") for x in chips()) and not m.locator("button:has-text('הרצה')").is_disabled(), chips())
    send("באגים של סקוואד מטאור")
    check("Hebrew squad name from the dictionary: no question", pg.locator(".msg.ask").last.locator(".ask-q").count() == 0 and "Squad: Meteor" in chips(), chips())
    # 2. parent
    send("הילדים של 110045 כולל סגורים")
    check("children of an item", chips() == ["פתוחים וסגורים", "תחת 110045"], chips())
    pg.locator(".msg.ask").last.locator("button:has-text('הרצה')").click(); pg.wait_for_timeout(1000)
    ids = [x.replace("✎", "").replace("🔒", "").strip() for x in pg.locator(".msg.bot table").last.locator("tbody tr td:first-child").all_inner_texts()]
    check("children found", ids == ["110047"], ids)
    # 3. a squad by its Hebrew name and words with synonyms
    send("איפה יש התייחסות לממשקים בסקוואד לוגיסטי")
    c = chips()
    check("Hebrew squad name and synonyms", "Squad: Logistics" in c and any(x.startswith("מילים:") and "API" in x for x in c), c)
    # 4. blocked, stale, closed last week, unassigned in sprint
    for q, want in [("פריטים חסומים", "חסומים (Blocked / Inactive)"), ("מה לא זז 30 יום", "לא עודכנו 30 יום"),
                    ("מה נסגר בשבוע שעבר", "נסגרו מ-11/10/2026 עד 17/10/2026"), ("מה לא שויך בספרינט הנוכחי", "לא שויך")]:
        send(q)
        check("question: " + q, want in chips(), chips())
    # 5. plain words still search as before
    n = pg.locator(".msg.ask").count()
    send("ייצוא לאקסל"); pg.wait_for_timeout(500)
    check("plain words: the regular search, not a question", pg.locator(".msg.ask").count() == n)
    # 6. ask for a synonym: mail to the admins
    pg.evaluate("TeamConfig.data.permissions = normalizePermissions({users:[{email:'boss@example.com', role:'admin'}]}); window.openMailto = u => { window.__mail = u; }; 0")
    send("באגים עם ממשקים")
    pg.locator(".msg.ask").last.locator("button:has-text('בקשה להוסיף')").click()
    mail = pg.evaluate("window.__mail") or ""
    check("synonym request mails the admins", mail.startswith("mailto:boss@example.com?subject=") and "%D7%9E%D7%9E%D7%A9%D7%A7" in mail, mail[:200])
    # 7. dictionary tab
    pg.evaluate("TeamConfig.data.permissions = normalizePermissions({}); TeamUI.open(); 0"); pg.click("#teamTabs [data-tab=dict]"); pg.wait_for_timeout(300)
    check("dictionary tab lists synonyms and Hebrew squad names", pg.locator("#teamBody .dicttable tbody tr").count() >= 5)
    pg.click("#teamBody button:has-text('+ שורה')")
    pg.locator("#teamBody .dicttable tbody tr").last.locator("input").last.fill("דוח, דוחות, report")
    d = pg.evaluate("TeamUI.prepared().dictionary")
    check("dictionary row saved", {"kind": "words", "target": "", "words": ["דוח", "דוחות", "report"]} in d, d[-1])
    pg.evaluate("TeamConfig.data.dictionary = TeamUI.prepared().dictionary; TeamUI.close(true); 0")
    w = pg.evaluate("Ask.parse('איפה מוזכרים דוחות').then(c => c.words[0].all)")
    check("new synonyms used in questions", "report" in w, w)
    check("no js errors (demo)", not errs, errs)
    # ---------- real Azure (mocked): the query sent ----------
    c2 = b.new_context(); c2.route("https://dev.azure.com/**", handler)
    p2 = c2.new_page(); e2 = []; p2.on("pageerror", lambda e: e2.append(str(e)))
    p2.goto("http://127.0.0.1:8824/"); p2.fill("#pat", PAT); p2.click("#patBtn"); p2.locator("#app:not(.hidden)").wait_for()
    p2.evaluate("Ask.today = '2026-10-20'; 0")
    p2.fill("#input", "באגים פתוחים של לוגיסטיקה עם ממשקים"); p2.keyboard.press("Enter"); p2.wait_for_timeout(1200)
    p2.locator(".msg.ask").last.locator("button:has-text('הרצה')").click(); p2.wait_for_timeout(1500)
    q = WIQL[-1]["q"] if WIQL else ""
    check("query: type, open, current PI, squad by field or its areas, words in title and description",
          "[System.WorkItemType] IN ('Bug')" in q and "[System.State] NOT IN ('Closed', 'Removed', 'Done')" in q and "[System.IterationPath] UNDER 'Portfolio Merkava\\PI4_26'" in q
          and "[Custom.LeadingSquad] IN ('Logistics')" in q and "[System.Title] CONTAINS 'ממשק'" in q and "[System.Description] CONTAINS WORDS 'API*'" in q and "$top=201" in WIQL[-1]["url"], q)
    ids = [x.replace("✎", "").replace("🔒", "").strip() for x in p2.locator(".msg.bot table").last.locator("tbody tr td:first-child").all_inner_texts()]
    check("api: results shown", ids == ["700", "701"], ids)
    MODE["fulltext"] = False
    p2.locator(".msg.ask").last.locator("button:has-text('הרצה')").click(); p2.wait_for_timeout(1500)
    check("no full-text search: title only, and it says so", "CONTAINS WORDS" not in WIQL[-1]["q"] and "בכותרת בלבד" in p2.locator(".msg.ask").last.inner_text())
    check("api: the user's name is never in the query (uses @Me)", all("tester@gov.example" not in x["q"] for x in WIQL))
    check("no js errors (api)", not e2, e2)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
