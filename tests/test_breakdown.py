"""Feature breakdown (פירוק פיצ'ר): the rules engine (node) and the screen (Playwright, demo mode)."""
import os, sys, json, subprocess
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:600]))
    if not c: fails.append(n)

# ---------------- engine (node) ----------------
NODE = r"""
const {BreakdownEngine: E} = require(process.argv[1]);
const out = {};
const a = E.rules({text: "מסך שבו החשב רואה את כל המוסדות שקיבלו תמיכה, עם סינון לפי שנה וסכום, וייצוא לאקסל. הנתונים מגיעים ממערכת מרכבה", value: "החשב יודע מהר כמה מוסדות קיבלו תמיכה", role: "חשב", ui: true});
out.a = a;
out.b = E.rules({text: "ניהול ספקים: הוספה, עדכון ומחיקה של ספקים עם הרשאות לפי תפקיד", value: "פחות טעויות", role: "", ui: false});
out.c = E.rules({text: "שיפור כללי של התהליך הקיים", value: "חיסכון בזמן", role: "רכזת", ui: false});
out.csv = E.csv(a).split("\r\n")[0];
out.prompt = E.prompt({text: "x", value: "y", role: "z", ui: true}, a);
out.parsed = E.parse("הנה התשובה:\n```json\n" + JSON.stringify({role: "חשב", stories: [{title: "א", asA: "חשב", iWant: "לראות", soThat: "אדע", pattern: "Workflow", sp: 1, priority: 9, acceptance: "א\nב", positive: ["1","2","3"], negative: ["1","2","3"]}]}) + "\n```", {text: "פיצ'ר", value: "ערך", ui: false});
try { E.parse("אין כאן כלום", {text: "x"}); out.bad = "no error"; } catch (e) { out.bad = e.message; }
try { E.parse('{"stories": []}', {text: "x"}); out.empty = "no error"; } catch (e) { out.empty = e.message; }
console.log(JSON.stringify(out));
"""
r = subprocess.run(["node", "-e", NODE, os.path.join(ROOT, "js", "breakdown.js")], capture_output=True, text=True)
check("engine runs in node", r.returncode == 0, r.stderr)
o = json.loads(r.stdout) if r.returncode == 0 else {}
if o:
    a = o["a"]; titles = [s["title"] for s in a["stories"]]
    check("engine: spike first when another system is involved", a["stories"][0]["pattern"] == "Spike Story" and "מרכבה" in titles[0], titles)
    check("engine: view / filters per criterion / export", any(t.startswith("צפייה במוסדות") for t in titles) and "סינון לפי שנה" in titles and "סינון לפי סכום" in titles and "ייצוא לאקסל" in titles, titles)
    check("engine: every story has SP >= 2, priority 1-4, 3+3 tests, criteria, tasks",
          all(s["sp"] >= 2 and 1 <= s["priority"] <= 4 and len(s["positive"]) == 3 and len(s["negative"]) == 3 and len(s["acceptance"]) >= 3 and s["tasks"] for s in a["stories"]), a["stories"])
    check("engine: user story sentence format", all(s["asA"] == "חשב" for s in a["stories"]) and a["stories"][1]["soThat"].startswith("החשב יודע"), a["stories"][1])
    check("engine: UI/UX task and prompt when UI is needed", any(t["title"].startswith("עיצוב UI/UX") for s in a["stories"] for t in s["tasks"]) and "מסכים ושדות" in a["uiPrompt"], a["uiPrompt"])
    check("engine: feature SP starts at 3, total and sprints", a["feature"]["sp"] == 3 and a["totalSp"] == sum(s["sp"] for s in a["stories"]) and sorted(i for sp in a["sprints"] for i in sp) == list(range(len(a["stories"]))))
    check("engine: sorted by priority", [s["priority"] for s in a["stories"]] == sorted(s["priority"] for s in a["stories"]))
    bt = [s["title"] for s in o["b"]["stories"]]
    check("engine: CRUD + permissions, no fake 'ספק' role", "הוספת ספקים" in bt and "מחיקת ספקים" in bt and "הרשאות לפי תפקיד" in bt and not any("ספק" in t and "תצוגה" in t for t in bt) and not o["b"]["uiPrompt"], bt)
    check("engine: fallback split when nothing is detected", [s["title"] for s in o["c"]["stories"]][0].startswith("גרסה בסיסית") and len(o["c"]["stories"]) == 3 and o["c"]["role"] == "רכזת", o["c"]["stories"])
    check("engine: CSV columns from the skill", o["csv"].lstrip("﻿") == '"US Name","Description","Acceptance Criteria","Story Points","Priority","Splitting Pattern","Positive Tests","Negative Tests","Tasks"', o["csv"])
    check("engine: AI prompt has the rules, inputs, draft and JSON shape", "INVEST" in o["prompt"] and "הערך העסקי ללקוח: y" in o["prompt"] and "טיוטה ראשונה" in o["prompt"] and '"stories"' in o["prompt"])
    p0 = o["parsed"]["stories"][0]
    check("engine: AI answer parsed and normalised (code block, SP min 2, priority max 4)", o["parsed"]["engine"] == "ai" and p0["sp"] == 2 and p0["priority"] == 4 and p0["acceptance"] == ["א", "ב"] and p0["tasks"], p0)
    check("engine: clear errors for bad AI answers", "JSON" in o["bad"] and "User Stories" in o["empty"], (o["bad"], o["empty"]))

# ---------------- screen ----------------
srv = start(8806)
FIX = json.load(open(os.path.join(ROOT, "tests", "fixtures", "team-config.json"), encoding="utf-8"))
AGENT_URL = "https://agent.example.test/breakdown"
agent_calls = []
def agent(route, req):
    cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "content-type, accept", "access-control-allow-methods": "POST, OPTIONS"}
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
    agent_calls.append({"headers": req.all_headers(), "body": json.loads(req.post_data)})
    return route.fulfill(status=200, headers=cors, json={"role": "חשב", "stories": [
        {"title": "מהסוכן 1", "asA": "חשב", "iWant": "לראות רשימה", "soThat": "אדע", "pattern": "תפעול/פעולות", "sp": 3, "priority": 1, "acceptance": ["א"], "positive": ["1", "2", "3"], "negative": ["1", "2", "3"]},
        {"title": "מהסוכן 2", "asA": "חשב", "iWant": "לסנן", "soThat": "אדע", "pattern": "פיתוח אינקרמנטלי (מפשוט למורכב)", "sp": 2, "priority": 2, "acceptance": ["ב"], "positive": ["1", "2", "3"], "negative": ["1", "2", "3"]}]})

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1300, "height": 900}, accept_downloads=True)
    ctx.grant_permissions(["clipboard-read", "clipboard-write"], origin="http://127.0.0.1:8806")
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8806/"); pg.click("#demoBtn"); pg.wait_for_timeout(300)
    check("header has the breakdown button", pg.locator("#bdBtn").is_visible() and "פירוק פיצ'ר" in pg.inner_text("#bdBtn"))
    check("no agent button without team setting", True)
    pg.click("#bdBtn"); pg.locator("#bdDlg:not(.hidden)").wait_for()
    check("dialog opens with focus on the feature text", pg.evaluate("document.activeElement.id") == "bdText")
    pg.click("#bdGo")
    check("feature text required", pg.is_visible("#bdErr") and pg.evaluate("document.activeElement.id") == "bdText", pg.inner_text("#bdErr"))
    pg.fill("#bdText", "מסך שבו החשב רואה את כל המוסדות שקיבלו תמיכה, עם סינון לפי שנה וסכום, וייצוא לאקסל")
    pg.click("#bdGo")
    check("business value required (skill question 1)", "ערך העסקי" in pg.inner_text("#bdErr") and pg.evaluate("document.activeElement.id") == "bdValue")
    pg.fill("#bdValue", "החשב יודע מהר כמה מוסדות קיבלו תמיכה")
    pg.click("#bdGo")
    check("UI/UX answer required (skill question 2)", "UI/UX" in pg.inner_text("#bdErr"))
    pg.fill("#bdRole", "חשב"); pg.check('input[name="bdUi"][value="1"]'); pg.click("#bdGo")
    pg.locator(".bd").first.wait_for(timeout=5000)
    card = pg.locator(".bd").last; txt = card.inner_text()
    check("dialog closes and result shows in chat", pg.locator("#bdDlg.hidden").count() == 1 and "פירוק פיצ'ר:" in pg.locator(".msg.user").last.inner_text())
    check("summary: stories, total SP, feature 3 SP, engine", "User Stories" in txt and "פיצ'ר: 3 SP" in txt and "כללים פנימיים" in txt, txt[:300])
    n = card.locator(".bd-us").count()
    check("one card per user story", n >= 4 and "סינון לפי שנה" in txt and "ייצוא לאקסל" in txt, n)
    check("sentence format shown", "כחשב, אני רוצה" in txt)
    check("sprint plan shown", "ספרינט 1" in txt)
    det = card.locator(".bd-us details").first
    check("details closed by default", not det.evaluate("d => d.open"))
    det.locator("summary").click()
    dt = det.inner_text()
    check("details: criteria, 3+3 tests, tasks", "Acceptance Criteria" in dt and "בדיקות חיוביות" in dt and "בדיקות שליליות" in dt and "Tasks" in dt and det.locator(".pos li").count() == 3 and det.locator(".neg li").count() == 3, dt[:300])
    check("UI/UX prompt shown when UI is needed", card.locator(".bd-uip").count() == 1)
    check("nothing saved note", "שום דבר לא נשמר ב-Azure" in txt)
    # copy
    card.locator(".bd-acts button", has_text="העתקה").click(); pg.wait_for_timeout(300)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check("copy puts the breakdown text in the clipboard", clip.startswith("פירוק פיצ'ר:") and "תנאי קבלה:" in clip, clip[:200])
    # CSV
    with pg.expect_download() as d: card.locator(".bd-acts button", has_text="CSV").click()
    dl = d.value; path = dl.path(); data = open(path, encoding="utf-8-sig").read()
    check("CSV download", dl.suggested_filename.startswith("feature-breakdown-") and dl.suggested_filename.endswith(".csv") and data.startswith('"US Name"') and "סינון לפי שנה" in data, dl.suggested_filename)
    # Excel
    pg.evaluate("window.showSaveFilePicker = undefined")
    with pg.expect_download() as d: card.locator(".bd-acts button", has_text="Excel").click()
    dl = d.value; raw = open(dl.path(), "rb").read()
    check("Excel download is a real xlsx", dl.suggested_filename.endswith(".xlsx") and raw[:2] == b"PK", dl.suggested_filename)
    # AI improve: copy prompt, paste a bad answer, then a good one
    card.locator(".bd-acts button", has_text="שיפור עם AI").click()
    box = card.locator(".bd-aibox"); box.wait_for()
    box.locator("button", has_text="העתקת ההנחיה").click(); pg.wait_for_timeout(300)
    clip = pg.evaluate("navigator.clipboard.readText()")
    check("AI prompt copied, without any token", "INVEST" in clip and "סינון לפי שנה" in clip and "PAT" not in clip and "Authorization" not in clip, clip[:200])
    box.locator("textarea[aria-label='התשובה מה-AI']").fill("סליחה, לא הבנתי")
    box.locator("button", has_text="עדכון הפירוק").click()
    check("bad AI answer explained, nothing replaced", box.locator(".bd-err").is_visible() and pg.locator(".bd").count() == 1, box.inner_text()[-200:])
    ai = {"role": "חשב", "stories": [{"title": "צפייה מה-AI", "asA": "חשב", "iWant": "לצפות במוסדות", "soThat": "אדע", "pattern": "תפעול/פעולות", "sp": 2, "priority": 1, "acceptance": ["א", "ב", "ג"], "positive": ["1", "2", "3"], "negative": ["1", "2", "3"], "tasks": [{"title": "פיתוח: צפייה"}]}], "uiPrompt": "מסך אחד"}
    box.locator("textarea[aria-label='התשובה מה-AI']").fill("```json\n" + json.dumps(ai, ensure_ascii=False) + "\n```")
    box.locator("button", has_text="עדכון הפירוק").click(); pg.wait_for_timeout(300)
    last = pg.locator(".bd").last
    check("AI answer becomes a new breakdown", pg.locator(".bd").count() == 2 and "צפייה מה-AI" in last.inner_text() and "שופר עם AI" in last.inner_text(), last.inner_text()[:200])
    # re-run keeps the answers
    last.locator(".bd-acts button", has_text="פירוק מחדש").click()
    check("re-run opens the dialog with the same answers", pg.input_value("#bdValue").startswith("החשב יודע") and pg.is_checked('input[name="bdUi"][value="1"]') and pg.input_value("#bdRole") == "חשב")
    pg.keyboard.press("Escape")
    check("Escape closes the dialog", pg.locator("#bdDlg.hidden").count() == 1)
    # chat command
    pg.fill("#input", "פרק: ניהול ספקים עם הוספה ומחיקה"); pg.keyboard.press("Enter"); pg.locator("#bdDlg:not(.hidden)").wait_for()
    check("chat command opens the dialog with the text", pg.input_value("#bdText") == "ניהול ספקים עם הוספה ומחיקה" and pg.input_value("#bdValue") == "" and pg.evaluate("document.activeElement.id") == "bdValue")
    pg.click("#bdCancel")
    pg.fill("#input", "עזרה"); pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    check("help mentions the breakdown", "פירוק פיצ'ר" in pg.locator(".msg.bot").last.inner_text())
    # phone
    pg.set_viewport_size({"width": 390, "height": 820}); pg.wait_for_timeout(300)
    check("no horizontal scroll on phone", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"))
    pg.locator(".bd").first.scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "breakdown_mobile.png"))
    pg.set_viewport_size({"width": 1300, "height": 900})
    pg.locator(".bd").first.scroll_into_view_if_needed(); pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "breakdown.png"))
    check("no js errors", not errs, errs)

    # ---- existing agent named in the team settings
    ctx2 = b.new_context(viewport={"width": 1300, "height": 900})
    ctx2.route("**/team-config.json*", lambda route, req: route.fulfill(status=200, json={**FIX, "breakdownAgent": {"url": AGENT_URL, "label": "פירוק עם הסוכן הארגוני"}}))
    ctx2.route(AGENT_URL, agent)
    pg = ctx2.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8806/"); pg.click("#demoBtn"); pg.wait_for_timeout(500)
    pg.fill("#input", "פרק: מסך שבו החשב רואה את המוסדות"); pg.keyboard.press("Enter"); pg.locator("#bdDlg:not(.hidden)").wait_for()
    pg.fill("#bdValue", "חיסכון בזמן"); pg.check('input[name="bdUi"][value="0"]'); pg.click("#bdGo"); pg.locator(".bd").wait_for()
    btn = pg.locator(".bd-acts button", has_text="פירוק עם הסוכן הארגוני")
    check("agent button appears when the team names an agent", btn.count() == 1)
    btn.click(); pg.wait_for_timeout(800)
    check("agent result shown as a new breakdown", pg.locator(".bd").count() == 2 and "מהסוכן 1" in pg.locator(".bd").last.inner_text() and "סוכן" in pg.locator(".bd").last.inner_text())
    call = agent_calls[-1] if agent_calls else {"headers": {}, "body": {}}
    check("agent gets the feature, never the token", call["body"].get("value") == "חיסכון בזמן" and call["body"].get("draft") and "authorization" not in call["headers"] and "cookie" not in call["headers"], call)
    check("agent: no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
