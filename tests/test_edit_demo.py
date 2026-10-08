import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:500]))
    if not c: fails.append(n)
os.makedirs(os.path.join(ROOT, "tests", "artifacts"), exist_ok=True)
shot = lambda pg, n: pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", n))
srv = start(8779)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900})
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e))); pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.goto("http://127.0.0.1:8779/"); pg.click("#demoBtn")
    send = lambda t: (pg.fill("#input", t), pg.keyboard.press("Enter"))
    send("110047, 112074, 112075"); pg.locator(".msg.bot table").first.wait_for()
    tbl = pg.locator(".msg.bot table").first
    hdr = [h.inner_text() for h in tbl.locator("th").all()]
    col = lambda name: hdr.index(name)
    row = lambda i: tbl.locator("tbody tr").nth(i)
    # 1. edit State of the Bug from its cell
    row(1).locator("td").nth(col("State")).click()
    pg.locator("#editPanel:not(.hidden)").wait_for()
    check("panel opened for the bug", "Bug 112074" in pg.inner_text("#epTitle"))
    sel = pg.locator("#epFields select[aria-label='State']")
    check("state editor focused with bug states", sel.count() == 1 and "In Progress" in sel.inner_text())
    sel.select_option("Resolved"); pg.locator("#epCheck .diffs").wait_for()
    check("diff shown", "State:" in pg.inner_text("#epCheck") and "Resolved" in pg.inner_text("#epCheck"))
    shot(pg, "edit_panel.png")
    pg.click("#epSave"); pg.locator(".msg.bot.ok").first.wait_for()
    check("saved + chat line", "✓ עודכן" in pg.locator(".msg.bot.ok").last.inner_text() and "Resolved" in pg.locator(".msg.bot.ok").last.inner_text())
    tbl = pg.locator(".msg.bot table").first
    check("table refreshed in place", tbl.locator("tbody tr").nth(1).locator("td").nth(col("State")).inner_text() == "Resolved")
    # 2. team-required field forces filling before save
    pg.evaluate("() => { TeamConfig.data.requiredFields['Bug'] = ['Microsoft.VSTS.Common.Severity']; }")
    tbl.locator("tbody tr").nth(1).locator("td").nth(col("Priority")).click()
    pg.locator("#editPanel:not(.hidden)").wait_for(); pg.locator("#epFields .eprow.needed").first.wait_for()
    check("missing required field auto-added", "Severity" in pg.inner_text("#epFields") and pg.locator("#epSave").is_disabled())
    check("explains why", "חסרים שדות חובה: Severity" in pg.inner_text("#epCheck"))
    pg.locator("#epFields select[aria-label='Priority']").select_option("1")
    check("still blocked without Severity", pg.locator("#epSave").is_disabled())
    pg.locator("#epFields select[aria-label='Severity']").select_option("2 - High")
    pg.wait_for_timeout(300)
    check("save enabled once filled", pg.locator("#epSave").is_enabled())
    pg.click("#epSave"); pg.locator(".msg.bot.ok").nth(1).wait_for()
    check("both fields saved", "Severity" in pg.locator(".msg.bot.ok").last.inner_text() and "Priority" in pg.locator(".msg.bot.ok").last.inner_text())
    # 3. Feature template: required heading empty blocks every save
    tbl = pg.locator(".msg.bot table").first
    tbl.locator("tbody tr").nth(2).locator("td").nth(col("State")).click()
    pg.locator("#editPanel:not(.hidden)").wait_for()
    pg.locator("#epFields select[aria-label='State']").select_option("Active"); pg.wait_for_timeout(300)
    check("feature blocked by template", pg.locator("#epSave").is_disabled() and "ערך ללקוח" in pg.inner_text("#epCheck"), pg.inner_text("#epCheck"))
    pg.locator("#epAdd").select_option("System.Description"); pg.locator("#epFields .rich.big").wait_for()
    pg.evaluate("""() => { const a = document.querySelector('#epFields .rich.big'); a.innerHTML = a.innerHTML.replace(/(ערך ללקוח:<\\/span><\\/u><\\/b><\\/div>)<div><br><\\/div>/, '$1<div>חיסכון של שעתיים בשבוע לכל לקוח</div>'); a.dispatchEvent(new Event('input')); }""")
    pg.wait_for_timeout(400)
    check("feature saves once template filled", pg.locator("#epSave").is_enabled(), pg.inner_text("#epCheck"))
    shot(pg, "edit_feature.png")
    pg.click("#epSave"); pg.locator(".msg.bot.ok").nth(2).wait_for()
    check("feature saved", "112075" in pg.locator(".msg.bot.ok").last.inner_text())
    # 4. chat: bulk update
    send("110047 112074 Priority=1; Tags +Urgent"); pg.locator(".editcard").last.wait_for()
    card = pg.locator(".editcard").last
    check("bulk preview lists 2 ready", card.locator("td.okc").count() == 2 and "שמירה ב-Azure (2)" in card.inner_text(), card.inner_text())
    shot(pg, "bulk_preview.png")
    card.locator("button:has-text('שמירה ב-Azure')").click(); card.locator("b:has-text('עודכנו 2')").wait_for()
    tbl = pg.locator(".msg.bot table").first
    check("bulk result refreshed first table", tbl.locator("tbody tr").nth(0).locator("td").nth(col("Priority")).inner_text() == "1")
    # 5. chat: bad state lists options
    send("112074 State Foo"); pg.locator(".editcard").nth(1).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("unknown value explained with options", "אין ערך כזה ב-State" in t and "Resolved" in t and pg.locator(".editcard").last.locator("button:has-text('שמירה')").is_disabled(), t)
    # 6. chat: assign to me
    send("112074 שייך לאני"); pg.locator(".editcard").nth(2).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("assign to me resolves", "משתמש הדגמה" in t, t)
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('עודכנו')").wait_for()
    # 7. chat: comment only
    send("112074 תגובה: נבדק בסביבת QA"); pg.locator(".editcard").nth(3).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("comment-only update ready", "+ תגובה" in t and "מוכן" in t, t)
    pg.locator(".editcard").last.locator("button:has-text('שמירה')").click(); pg.locator(".editcard").last.locator("b:has-text('עודכנו')").wait_for()
    # 8. iteration by last segment
    send("110047 Iteration 4.2"); pg.locator(".editcard").nth(4).wait_for()
    t = pg.locator(".editcard").last.inner_text()
    check("iteration resolved from 4.2", "PI4_26\\4.2" in t and "מוכן" in t, t)
    pg.locator(".editcard").last.locator("button:has-text('ביטול')").click()
    check("cancel", "בוטל" in pg.locator(".editcard").last.inner_text())
    # 9. conflict
    tbl = pg.locator(".msg.bot table").first
    tbl.locator("tbody tr").nth(0).locator("td").nth(col("Priority")).click(); pg.locator("#editPanel:not(.hidden)").wait_for()
    pg.locator("#epFields select[aria-label='Priority']").select_option("3")
    pg.evaluate("() => { DemoDB.map.get(110047).rev += 1; }")
    pg.wait_for_timeout(200); pg.click("#epSave"); pg.locator("#epCheck .bad").first.wait_for()
    check("conflict detected", "עודכן בינתיים" in pg.inner_text("#epCheck") and pg.inner_text("#epSave") == "שליפה מחדש")
    pg.click("#epCancel")
    # 10. regular lookups unaffected
    send("110047 רק Title ו-State"); pg.wait_for_timeout(900)
    last = pg.locator(".msg.bot").last
    check("lookup still works", last.locator("th").count() == 3, last.inner_text()[:200])
    # 11. not editable cells
    check("ID/Attachments cells not editable", pg.locator(".msg.bot table").first.locator("tbody tr").nth(1).locator("td").nth(col("Attachments")).get_attribute("class").find("ed") < 0)
    # phone layout of the panel
    pg.set_viewport_size({"width": 390, "height": 820})
    pg.locator(".msg.bot table").first.locator(".rowedit").first.click(); pg.locator("#editPanel:not(.hidden)").wait_for()
    check("panel fits phone", pg.evaluate("() => document.getElementById('editPanel').getBoundingClientRect().width") <= 390)
    shot(pg, "edit_mobile.png")
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
