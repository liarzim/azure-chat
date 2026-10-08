"""Chat search: words instead of numbers -> a list to pick from -> the usual table. Demo + mocked Azure DevOps."""
import os, sys, json, re, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:600]))
    if not c: fails.append(n)
srv = start(8805)

with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1300, "height": 900}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8805/"); pg.click("#demoBtn"); pg.wait_for_timeout(300)
    send = lambda t: (pg.fill("#input", t), pg.keyboard.press("Enter"))
    send("דיווח"); pg.locator(".srch").first.wait_for(timeout=8000)
    card = pg.locator(".srch").last
    rows = card.locator(".srch-row")
    check("words search shows a list", rows.count() >= 1 and "דיווח" in card.inner_text(), card.inner_text())
    check("nothing selected yet", card.locator(".srch-foot .btn").is_disabled())
    rows.first.locator("label").click()
    check("picking one enables the button", "הצג בטבלה (1)" in card.locator(".srch-foot .btn").inner_text() and rows.first.get_attribute("class").count("on") == 1)
    first_id = rows.first.locator(".srch-id").inner_text()
    card.locator(".srch-foot .btn").click(); pg.locator(".msg.bot table").first.wait_for()
    t = pg.locator(".msg.bot table").last
    check("picked item shown as a table", t.locator("tbody tr").count() == 1 and first_id in t.inner_text(), t.inner_text()[:200])
    # several / all
    send("הדגמה"); pg.locator(".srch").nth(1).wait_for()
    card = pg.locator(".srch").last
    n = card.locator(".srch-row").count()
    card.locator(".srch-foot label").click()
    check("select all", f"הצג בטבלה ({n})" in card.locator(".srch-foot .btn").inner_text(), card.locator(".srch-foot .btn").inner_text())
    card.locator(".srch-row").first.locator("input").uncheck()
    check("partial selection", f"({n-1})" in card.locator(".srch-foot .btn").inner_text() and card.locator(".srch-foot input").evaluate("e => e.indeterminate"))
    card.locator(".srch-foot .btn").click(); pg.wait_for_timeout(1500)
    check("several items in one table", pg.locator(".msg.bot table").last.locator("tbody tr").count() == n - 1, pg.locator(".msg.bot table").last.locator("tbody tr").count())
    # quick single show
    card.locator(".srch-one").first.click(); pg.wait_for_timeout(1500)
    check("row 'show' button gives one item", pg.locator(".msg.bot table").last.locator("tbody tr").count() == 1)
    # closed toggle and empty result
    send("משהו שלא קיים בכלל"); pg.locator(".srch").last.locator(".srch-empty").wait_for()
    check("no results explained", "לא מצאתי" in pg.locator(".srch").last.inner_text())
    before = pg.locator(".srch").count()
    pg.locator(".srch").last.locator(".srch-head .btn").click(); pg.wait_for_timeout(800)
    check("closed toggle reruns in place", pg.locator(".srch").count() == before and "רק פתוחים" in pg.locator(".srch").last.inner_text())
    # numbers still do a lookup; explicit prefix searches even with numbers
    send("110047"); pg.wait_for_timeout(1500)
    check("numbers still fetch directly", pg.locator(".msg.bot").last.locator("table").count() == 1)
    send("חפש: הדגמה 1120"); pg.wait_for_timeout(1500)
    check("explicit search with numbers", pg.locator(".msg.bot").last.locator(".srch").count() == 1 and pg.locator(".msg.bot").last.locator(".srch-row").count() >= 1, pg.locator(".msg.bot").last.inner_text()[:200])
    check("commands still work", (send("עזרה"), pg.wait_for_timeout(300), "חיפוש" in pg.locator(".msg.bot").last.inner_text())[2])
    pg.set_viewport_size({"width": 390, "height": 820}); send("דיווח"); pg.wait_for_timeout(1200)
    check("no horizontal scroll on phone", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"))
    pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "search_mobile.png"))
    check("no js errors", not errs, errs)
    b.close()

# ---- mocked Azure DevOps: the WIQL query
PAT = "test-pat"; AUTH = "Basic " + base64.b64encode((":" + PAT).encode()).decode()
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}
wiqls = []
def item(i, t, typ, st): return {"id": i, "rev": 1, "fields": {"System.Id": i, "System.Title": t, "System.WorkItemType": typ, "System.State": st, "System.TeamProject": "Portfolio Merkava", "System.IterationPath": "Portfolio Merkava\\PI4_26\\4.1", "System.AssignedTo": {"displayName": "דנה כהן", "uniqueName": "dana@x.com"}}, "relations": []}
ITEMS = {501: item(501, "ייצוא לאקסל במסך דוחות", "User Story", "Active"), 502: item(502, "באג בייצוא לאקסל", "Bug", "New")}
def handler(route, req):
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    u = req.url; J = lambda d, s=200: route.fulfill(status=s, json=d, headers=CORS)
    if req.all_headers().get("authorization") != AUTH: return route.fulfill(status=203, body="x", headers={**CORS, "content-type": "text/html"})
    if "/_apis/projects?" in u: return J({"value": []})
    if "/_apis/connectionData" in u: return J({"authenticatedUser": {"providerDisplayName": "מיכאל", "properties": {"Account": {"$value": "m@x.com"}}}})
    if "/_apis/wit/wiql" in u: wiqls.append(json.loads(req.post_data)["query"]); return J({"workItems": [{"id": 501}, {"id": 502}]})
    m = re.search(r"/_apis/wit/workitems\?ids=([\d,]+)", u)
    if m: return J({"value": [ITEMS[int(x)] for x in m.group(1).split(",") if int(x) in ITEMS]})
    return J({"value": []}) if "/work/processes" in u or "workitemtypes" in u or "/_apis/wit/fields" in u else J({"message": "not mocked"}, 404)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1300, "height": 900}); ctx.route("https://dev.azure.com/**", handler)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8805/"); pg.fill("#pat", PAT); pg.click("#patBtn"); pg.locator("#app:not(.hidden)").wait_for()
    pg.fill("#input", "ייצוא לאקסל"); pg.keyboard.press("Enter"); pg.locator(".srch .srch-row").first.wait_for(timeout=8000)
    q = wiqls[-1]
    check("api: title + description words, open only, newest first", "[System.Title] CONTAINS 'ייצוא לאקסל'" in q and "CONTAINS WORDS 'ייצוא לאקסל'" in q and "NOT IN ('Closed'" in q and "ORDER BY [System.ChangedDate] DESC" in q, q)
    check("api: results listed with type, state and assignee", "501" in pg.inner_text(".srch") and "דנה כהן" in pg.inner_text(".srch") and "Bug" in pg.inner_text(".srch"))
    pg.locator(".srch-head .btn").click(); pg.wait_for_timeout(1000)
    check("api: closed toggle drops the state filter", "NOT IN" not in wiqls[-1], wiqls[-1])
    pg.fill("#input", "חפש: o'reilly"); pg.keyboard.press("Enter"); pg.wait_for_timeout(1000)
    check("api: quotes escaped in WIQL", "'o''reilly'" in wiqls[-1], wiqls[-1])
    check("api: no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
