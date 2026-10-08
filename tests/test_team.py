import os, sys, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:400]))
    if not c: fails.append(n)
srv = start(8778)
BASE = "http://127.0.0.1:8778/"
remote = {"json": json.load(open(os.path.join(ROOT, "team-config.json"), encoding="utf-8")), "sha": "sha1", "puts": []}
def gh(route, req):
    u = req.url; h = req.all_headers()
    if h.get("authorization") != "Bearer ghp_test": return route.fulfill(status=401, json={"message": "Bad credentials"})
    if u.endswith("/repos/liarzim/azure-chat"): return route.fulfill(status=200, json={"full_name": "liarzim/azure-chat", "permissions": {"push": True}})
    if "/contents/team-config.json" in u and req.method == "GET":
        b = base64.b64encode(json.dumps(remote["json"], ensure_ascii=False).encode()).decode()
        return route.fulfill(status=200, json={"sha": remote["sha"], "content": b})
    if "/contents/team-config.json" in u and req.method == "PUT":
        body = json.loads(req.post_data); remote["puts"].append(body)
        remote["json"] = json.loads(base64.b64decode(body["content"]).decode()); remote["sha"] = "sha" + str(len(remote["puts"]) + 1)
        return route.fulfill(status=200, json={"content": {"sha": remote["sha"]}})
    return route.fulfill(status=404, json={})
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1300, "height": 900})
    ctx.route("https://api.github.com/**", gh)
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto(BASE); pg.click("#demoBtn"); pg.click("#teamBtn")
    pg.locator(".fgroup").first.wait_for()
    groups = [s.inner_text() for s in pg.locator(".fgroup summary").all()]
    check("Feature groups follow the Azure form", groups[0].startswith("כותרת הטופס") and any(g.startswith("Planning") for g in groups) and any(g.startswith("Requirements") for g in groups), groups)
    txt = pg.inner_text("#teamBody")
    check("form labels shown (לקוח מוביל, Dev Owner Name, Assigned To)", "לקוח מוביל" in txt and "Dev Owner Name" in txt and "Assigned To" in txt and "Assi&gned" not in txt)
    title_cb = pg.locator("tr:has(td:text-is('Title')) input[type=checkbox]")
    check("Title locked as Azure-required", title_cb.is_checked() and title_cb.is_disabled())
    ls = pg.locator("tr:has(td:text-is('Leading Squad')) input[type=checkbox]").first
    check("Leading Squad starts optional", not ls.is_checked())
    ls.check()
    check("dirty marker", "לא נשמרו" in pg.inner_text("#teamStatus"))
    check("type chip count", "Feature (1)" in pg.inner_text("#teamTypes"))
    pg.fill("#fieldFilter", "squad"); n_rows = pg.locator(".ftable tbody tr").count()
    check("search filters", n_rows == 1, n_rows)
    pg.fill("#fieldFilter", ""); pg.check("#onlyReq")
    req_rows = [r.inner_text().split("\t")[0] for r in pg.locator(".ftable tbody tr").all()]
    check("only-required view includes Leading Squad + Azure required", any("Leading Squad" in r for r in req_rows) and any("Title" in r for r in req_rows) and len(req_rows) == 8, req_rows)
    pg.uncheck("#onlyReq")
    # Business priority exists in Feature but not in User Story
    pg.click("#teamTypes .seg:has-text('User Story')"); pg.locator(".fgroup").first.wait_for()
    check("User Story has no Business priority", "Business priority" not in pg.inner_text("#teamBody") and "לקוח מוביל" in pg.inner_text("#teamBody"))
    pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "team_fields.png"), full_page=False) if os.makedirs(os.path.join(ROOT, "tests", "artifacts"), exist_ok=True) is None else None
    # Template tab
    pg.click("#teamTabs [data-tab=template]"); pg.click("#teamTypes .seg:has-text('Feature')")
    rows = pg.locator(".ttable tbody tr")
    check("7 template headings", rows.count() == 7, rows.count())
    req = [r.locator("input[type=checkbox]").is_checked() for r in rows.all()]
    check("only first two required", req == [True, True, False, False, False, False, False], req)
    pv = pg.inner_text("#tplPreview")
    check("preview shows headings + QA lines", "תאור הדרישה:" in pv and "15 - Medium" in pv and pv.count("חובה") == 2, pv[:200])
    # rename heading 3 -> alias kept
    h3 = rows.nth(2).locator(".hin"); h3.fill("Acceptance Criteria (What to Demo?)"); h3.press("Tab")
    pg.click("#teamTabs [data-tab=template]")
    check("rename keeps old wording as alias", "ACCEPTENCE CRATIRIA" in pg.locator(".ttable tbody tr").nth(2).inner_text())
    # move last up, delete one, add one
    pg.locator(".ttable tbody tr").nth(6).locator("button[aria-label='הזזה למעלה']").click()
    check("reorder", "QA-" in pg.locator(".ttable tbody tr").nth(5).locator(".hin").input_value())
    pg.locator(".ttable tbody tr").nth(4).locator("button.del").click()
    pg.click("button:has-text('+ כותרת')"); pg.locator(".hin").last.fill("הערות נוספות")
    check("7 rows after delete+add", pg.locator(".ttable tbody tr").count() == 7)
    pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "team_template.png"), full_page=True)
    # Save without token -> goes to GitHub tab
    pg.click("#teamSave")
    check("save without token opens GitHub tab", pg.locator("#ghTok").is_visible())
    pg.fill("#ghTok", "ghp_test"); pg.click("#ghSave")
    pg.locator("#ghMsg:has-text('מחובר')").wait_for(timeout=5000)
    check("token test ok", "מחובר ל-liarzim/azure-chat" in pg.inner_text("#ghMsg"))
    pg.click("#teamSave"); pg.locator("#toast:has-text('נשמר ב-GitHub')").wait_for(timeout=5000)
    saved = remote["json"]
    check("PUT happened with sha", len(remote["puts"]) == 1 and remote["puts"][0]["sha"] == "sha1")
    check("saved required field", saved["requiredFields"]["Feature"] == ["Custom.LeadingSquad"], saved["requiredFields"])
    hs = saved["templates"]["Feature"]["headings"]
    check("saved template", [h["text"] for h in hs][-1] == "הערות נוספות" and hs[2]["aliases"] == ["Feature Specific ACCEPTENCE CRATIRIA (What to Demo?)"] and len(hs) == 7, [h["text"] for h in hs])
    check("saved updatedAt/by", saved["updatedAt"] and saved["updatedBy"] == "משתמש הדגמה")
    check("not dirty after save", "לא נשמרו" not in pg.inner_text("#teamStatus"))
    # Conflict: someone else saves in between
    remote["json"] = dict(saved, updatedAt="2099-01-01T00:00:00Z", updatedBy="מישהו אחר")
    pg.click("#teamTabs [data-tab=fields]"); pg.locator("tr:has(td:text-is('Gov Office')) input[type=checkbox]").first.check()
    pg.click("#teamSave"); pg.locator("#teamConfirm:has-text('מישהו אחר')").wait_for(timeout=5000)
    check("conflict warning shown", "מישהו אחר" in pg.inner_text("#teamConfirm") and len(remote["puts"]) == 1)
    pg.click("#teamConfirm button:has-text('לשמור ולדרוס')")
    for _ in range(50):
        if len(remote["puts"]) >= 2: break
        pg.wait_for_timeout(100)
    check("overwrite after confirm", len(remote["puts"]) == 2 and "Custom.GovOffice" in remote["json"]["requiredFields"]["Feature"])
    # Close with unsaved changes asks first
    pg.locator("tr:has(td:text-is('MVP')) input[type=checkbox]").first.check()
    pg.click("#teamClose")
    check("close asks when dirty", pg.locator("#teamConfirm").is_visible() and not pg.locator("#teamPanel").is_hidden())
    pg.click("#teamConfirm button:has-text('סגירה בלי שמירה')")
    check("closed", pg.locator("#teamPanel").is_hidden())
    # Mobile layout
    pg.set_viewport_size({"width": 390, "height": 820}); pg.click("#teamBtn"); pg.click("#teamTabs [data-tab=template]")
    sw = pg.evaluate("() => document.documentElement.scrollWidth")
    check("no horizontal scroll on phone", sw <= 390, sw)
    pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "team_mobile.png"))
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
