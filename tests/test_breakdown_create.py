"""Feature breakdown, stage 2: creating the Feature + User Stories + Tasks. Demo mode and mocked Azure DevOps."""
import os, sys, json, re, base64
from urllib.parse import unquote
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:700]))
    if not c: fails.append(n)
srv = start(8809)
FIX = json.load(open(os.path.join(ROOT, "tests", "fixtures", "team-config.json"), encoding="utf-8"))
REQ = {"Epic": [], "Feature": ["System.AreaPath", "System.IterationPath", "Custom.StoryPointsValues", "Custom.LeadingSquad", "Custom.Customer"],
       "User Story": ["Custom.Customer", "Custom.StoryPointsValues", "Custom.LeadingSquad"], "Task": ["Microsoft.VSTS.Scheduling.OriginalEstimate"], "Bug": []}
CFG = {**FIX, "requiredFields": REQ}
TEXT = "מסך שבו החשב רואה את כל המוסדות שקיבלו תמיכה, עם סינון לפי שנה וסכום, וייצוא לאקסל. הנתונים מגיעים ממערכת מרכבה"

def breakdown(pg):
    pg.evaluate("BreakdownCreate.today = '2026-10-09'")
    pg.click("#bdBtn"); pg.fill("#bdText", TEXT); pg.fill("#bdValue", "החשב יודע מהר כמה מוסדות קיבלו תמיכה")
    pg.fill("#bdRole", "חשב"); pg.check('input[name="bdUi"][value="1"]'); pg.click("#bdGo"); pg.locator(".bd").last.wait_for()
    pg.locator(".bd").last.locator(".bd-acts button", has_text="יצירה ב-Azure").click()
    pg.locator("#bcPanel .bc-us").first.wait_for(timeout=10000); pg.wait_for_timeout(600)

def sel(pg, sec, label, value):
    pg.locator("#bcBody .bc-sec").nth(sec).locator(".eprow", has=pg.locator("label", has_text=label)).first.locator("select").select_option(value)

def fill_all(pg):
    sel(pg, 0, "Leading Squad", "Meteor")
    sel(pg, 0, "לקוח", "סיגמה")
    for i in range(pg.locator(".bc-est").count()): pg.locator(".bc-est").nth(i).fill(str(2 + i % 3))
    pg.wait_for_timeout(500)

# ---------------- demo ----------------
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1300, "height": 900})
    ctx.route("**/team-config.json*", lambda route, req: route.fulfill(status=200, json=CFG))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8809/"); pg.click("#demoBtn"); pg.wait_for_timeout(400)
    breakdown(pg)
    n_us = pg.locator(".bc-us").count(); n_tasks = pg.locator(".bc-task").count()
    check("panel lists every US with its tasks", n_us >= 5 and n_tasks >= 2 * n_us, (n_us, n_tasks))
    chk = pg.inner_text("#bcCheck")
    check("asks about the parent Epic first", "האם יש Epic אב" in chk, chk)
    check("team required fields of the Feature are asked", "Leading Squad" in chk and "Feature" in chk, chk)
    check("Original Estimate required on every task", "Original Estimate" in chk and pg.locator(".bc-est.needed").count() == n_tasks, chk)
    check("create button blocked until complete", pg.locator("#bcGo").is_disabled())
    fsp = pg.locator(".bc-feat").first.locator("select").first.input_value()
    check("feature SP 3 -> '03 = 2-4d' from the Azure list", fsp == "03 = 2-4d", fsp)
    check("one Feature at PI level (not a sprint)", pg.locator(".bc-feat").count() == 1 and pg.locator(".bc-feat .bc-pi").inner_text() == "PI4_26", pg.locator(".bc-feats").inner_text())
    us_sp = [pg.locator(".bc-us").nth(i).locator(".bc-us-fields select").first.input_value() for i in range(n_us)]
    check("US SP mapped to the list (2 -> 02, 3 -> 03)", all(v in ("02 = 1-2d", "03 = 2-4d") for v in us_sp) and "02 = 1-2d" in us_sp, us_sp)
    iters = [pg.locator(".bc-us").nth(i).locator(".pk-btn").inner_text().split("\n")[0] for i in range(n_us)]
    check("sprints assigned from the current sprint by the plan", iters[0] == "4.1" and iters == sorted(iters) and "4.2" in iters, iters)
    pg.select_option("#bcFirst", "1"); pg.wait_for_timeout(200)
    iters2 = [pg.locator(".bc-us").nth(i).locator(".pk-btn").inner_text().split("\n")[0] for i in range(n_us)]
    check("changing sprint 1 shifts all", iters2[0] == "4.2" and "4.1" not in iters2 and "1.1" in iters2, iters2)
    pg.wait_for_timeout(400)
    feats = pg.locator(".bc-feat")
    pis = feats.locator(".bc-pi").all_inner_texts()
    check("sprints past the PI: split into a Feature per PI", feats.count() == 2 and pis == ["PI4_26", "PI1_27"], pis)
    t2 = feats.nth(1).locator(".bc-title").input_value(); t1 = feats.nth(0).locator(".bc-title").input_value()
    last_us = pg.locator(".bc-us").last.locator(".bc-us-top .bc-title").input_value()
    check("split Features named by their US content", last_us in t2 and last_us not in t1 and t1 != t2, (t1, t2))
    sp2 = feats.nth(1).locator("select").first.input_value()
    check("split Feature SP = its highest US", sp2 == "02 = 1-2d", sp2)
    pg.evaluate("TeamConfig.data.featureMaxSprints = 2; 0"); pg.select_option("#bcFirst", "0"); pg.wait_for_timeout(500)
    sprs = [x.split("ספרינטים: ")[-1] for x in pg.locator(".bc-feat .bc-what").all_inner_texts()]
    check("at most N sprints per Feature (setting)", pg.locator(".bc-feat").count() == 2 and sprs == ["4.1, 4.2", "4.3"], sprs)
    pg.evaluate("delete TeamConfig.data.featureMaxSprints; 0"); pg.select_option("#bcFirst", "1"); pg.select_option("#bcFirst", "0"); pg.wait_for_timeout(500)
    check("back to one Feature", pg.locator(".bc-feat").count() == 1, pg.locator(".bc-feat").count())
    # shared US fields follow the Feature
    sel(pg, 0, "Leading Squad", "Meteor")
    pg.wait_for_timeout(300)
    us_ls = pg.locator("#bcBody .bc-sec").nth(2).locator(".eprow", has=pg.locator("label", has_text="Leading Squad")).locator("select").input_value()
    check("US Leading Squad follows the Feature", us_ls == "Meteor", us_ls)
    sel(pg, 2, "Leading Squad", "CRM")
    sel(pg, 0, "Leading Squad", "Finance"); pg.wait_for_timeout(300)
    us_ls = pg.locator("#bcBody .bc-sec").nth(2).locator(".eprow", has=pg.locator("label", has_text="Leading Squad")).locator("select").input_value()
    check("a value changed for the US is kept", us_ls == "CRM", us_ls)
    sel(pg, 0, "Leading Squad", "Meteor")
    # Epic: yes -> number -> card
    pg.check('input[name="bcEpicQ"][value="1"]'); pg.fill("#bcEpic", "900001"); pg.locator("#bcEpicInfo.parentcard").wait_for(timeout=5000)
    check("Epic card shows its title", "Epic" in pg.inner_text("#bcEpicInfo") and "900001" in pg.inner_text("#bcEpicInfo"))
    fill_all(pg)
    # leave out the last US
    last = pg.locator(".bc-us").last; last.locator(".bc-us-top input[type=checkbox]").uncheck(); pg.wait_for_timeout(500)
    chk = pg.inner_text("#bcCheck")
    exp_tasks = n_tasks - last.locator(".bc-task").count()
    check("ready when complete, counts exclude the unchecked US", "הכל מוכן" in chk and str(n_us - 1) + " User Stories" in chk and str(exp_tasks) + " Tasks" in chk, chk)
    total = 1 + (n_us - 1) + exp_tasks
    check("button says how many items", pg.inner_text("#bcGo") == "יצירת " + str(total) + " פריטים ב-Azure", pg.inner_text("#bcGo"))
    before = pg.evaluate("DemoDB.map.size")
    pg.click("#bcGo")
    check("second confirmation before writing", pg.is_visible("#bcConfirm") and "לאשר יצירה" in pg.inner_text("#bcConfirm") and pg.evaluate("DemoDB.map.size") == before)
    pg.click("#bcNo"); check("back from confirmation writes nothing", pg.is_visible("#bcGo") and pg.evaluate("DemoDB.map.size") == before)
    pg.click("#bcGo"); pg.click("#bcYes")
    pg.locator(".bc-done").wait_for(timeout=30000)
    done = pg.locator(".bc-done").inner_text()
    check("summary in chat", "נוצרו " + str(total) + " פריטים" in done and "Feature" in done and "Task" in done, done[:300])
    check("panel closed", pg.locator("#bcPanel.hidden").count() == 1)
    items = pg.evaluate("[...DemoDB.map.values()].filter(x => x.id >= 300001)")
    feat = [x for x in items if x["fields"]["System.WorkItemType"] == "Feature"]
    uss = [x for x in items if x["fields"]["System.WorkItemType"] == "User Story"]
    tks = [x for x in items if x["fields"]["System.WorkItemType"] == "Task"]
    check("created: 1 Feature, the US and the Tasks", len(feat) == 1 and len(uss) == n_us - 1 and len(tks) == exp_tasks, (len(feat), len(uss), len(tks)))
    F = feat[0]["fields"]
    check("Feature Iteration is the PI", F.get("System.IterationPath") == "Portfolio Merkava\\PI4_26", F.get("System.IterationPath"))
    check("Feature under the Epic, with tag, SP value and required fields", F.get("System.Parent") == 900001 and F.get("System.Tags") == "אז'ורי-פירוק" and F.get("Custom.StoryPointsValues") == "03 = 2-4d" and F.get("Custom.LeadingSquad") == "Meteor" and F.get("Custom.Customer") == "סיגמה", F)
    check("Feature Description: template headings filled", "תאור הדרישה" in F["System.Description"] and "המוסדות שקיבלו תמיכה" in F["System.Description"] and "החשב יודע מהר" in F["System.Description"] and "סינון לפי שנה" in F["System.Description"], F["System.Description"][:300])
    U = uss[0]["fields"]
    check("US under the Feature, area from Feature, shared fields, sprint", all(u["fields"].get("System.Parent") == feat[0]["id"] for u in uss) and U.get("Custom.LeadingSquad") == "CRM" and U.get("Custom.Customer") == "סיגמה" and U["System.IterationPath"].endswith("4.1") and U.get("System.Tags") == "אז'ורי-פירוק", U)
    d = U["System.Description"]
    check("US Description: template headings, sentence, criteria and 3+3 tests", "תאור הדרישה" in d and "כחשב, אני רוצה" in d and "בדיקות חיוביות" in d and "בדיקות שליליות" in d and d.count("<li>") >= 9, d[:400])
    us_ids = {u["id"] for u in uss}
    check("Tasks under their US, with estimate and the US sprint", all(t["fields"].get("System.Parent") in us_ids and t["fields"].get("Microsoft.VSTS.Scheduling.OriginalEstimate") in (2, 3, 4) for t in tks)
          and all(t["fields"]["System.IterationPath"] == next(u for u in uss if u["id"] == t["fields"]["System.Parent"])["fields"]["System.IterationPath"] for t in tks), tks[:2])
    pg.locator(".bc-done button", has_text="הצגה בטבלה").click(); pg.wait_for_timeout(1500)
    check("created items shown as a table", pg.locator(".msg.bot table").last.locator("tbody tr").count() == total)
    # split creation: start at the last sprint of PI4_26 -> two Features
    breakdown(pg)
    pg.check('input[name="bcEpicQ"][value="0"]'); pg.wait_for_timeout(300)
    check("Epic 'no': no Epic needed", "Epic" not in pg.inner_text("#bcCheck"), pg.inner_text("#bcCheck"))
    pg.select_option("#bcFirst", "2"); fill_all(pg)
    before_ids = set(pg.evaluate("[...DemoDB.map.keys()]"))
    check("split ready: two Features", "2 Features" in pg.inner_text("#bcCheck"), pg.inner_text("#bcCheck"))
    pg.click("#bcGo"); check("confirmation names the Features", "2 Features" in pg.inner_text("#bcConfirm")); pg.click("#bcYes"); pg.locator(".bc-done").nth(1).wait_for(timeout=30000)
    new = [x for x in pg.evaluate("[...DemoDB.map.values()]") if x["id"] not in before_ids]
    nf = [x for x in new if x["fields"]["System.WorkItemType"] == "Feature"]
    piof = {x["id"]: x["fields"]["System.IterationPath"].split("\\")[-1] for x in nf}
    nus = [x for x in new if x["fields"]["System.WorkItemType"] == "User Story"]
    ok_par = all(piof.get(u["fields"].get("System.Parent")) == ("PI4_26" if u["fields"]["System.IterationPath"].endswith("4.3") else "PI1_27") for u in nus)
    check("split created: 2 Features at PI level, each US under the Feature of its PI", sorted(piof.values()) == ["PI1_27", "PI4_26"] and ok_par and len(nus) == n_us, (piof, [(u["fields"].get("System.Parent"), u["fields"]["System.IterationPath"]) for u in nus]))
    check("summary lists both Features", pg.locator(".bc-done").last.locator(".bc-done-f").count() == 2)
    breakdown(pg)
    pg.set_viewport_size({"width": 390, "height": 820}); pg.wait_for_timeout(300)
    check("phone: no horizontal scroll in the panel", pg.evaluate("document.getElementById('bcBody').scrollWidth <= document.getElementById('bcBody').clientWidth + 1"), pg.evaluate("[document.getElementById('bcBody').scrollWidth, document.getElementById('bcBody').clientWidth]"))
    pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "breakdown_create_mobile.png"))
    pg.set_viewport_size({"width": 1300, "height": 900}); pg.screenshot(path=os.path.join(ROOT, "tests", "artifacts", "breakdown_create.png"))
    pg.keyboard.press("Escape"); check("Escape closes the panel", pg.locator("#bcPanel.hidden").count() == 1)
    check("no js errors", not errs, errs)
    b.close()

# ---------------- mocked Azure DevOps ----------------
META = json.load(open(os.path.join(ROOT, "demo", "meta.json"), encoding="utf-8"))
PAT = "test-pat"; AUTH = "Basic " + base64.b64encode((":" + PAT).encode()).decode()
CORS = {"access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept", "access-control-allow-methods": "GET, POST, PATCH, OPTIONS"}
posts = []; nid = {"v": 700001}; fail_title = {"v": None}
import copy
NODES_NO_NEXT_PI = copy.deepcopy(META["classificationnodes"])
for r in NODES_NO_NEXT_PI:
    if r["structureType"] == "iteration": r["children"] = [c for c in r["children"] if c["name"] != "PI1_27"]
EPIC = {"id": 800001, "rev": 1, "url": "https://dev.azure.com/GOI-Finance/p/_apis/wit/workItems/800001", "fields": {"System.WorkItemType": "Epic", "System.Title": "אפיק בדיקה", "System.State": "New", "System.TeamProject": "Portfolio Merkava", "System.AreaPath": "Portfolio Merkava\\MK2\\Meteor", "System.IterationPath": "Portfolio Merkava\\PI4_26"}, "relations": []}
def handler(route, req):
    if req.method == "OPTIONS": return route.fulfill(status=204, headers=CORS)
    u = req.url; J = lambda d, s=200: route.fulfill(status=s, json=d, headers=CORS)
    if req.all_headers().get("authorization") != AUTH: return route.fulfill(status=203, body="x", headers={**CORS, "content-type": "text/html"})
    if "/_apis/projects?" in u: return J({"value": []})
    if "/_apis/connectionData" in u: return J({"authenticatedUser": {"providerDisplayName": "מיכאל", "properties": {"Account": {"$value": "m@x.com"}}}})
    if "/_apis/wit/fields?" in u: return J({"value": META["fields"]})
    if "/classificationnodes?" in u: return J({"value": NODES_NO_NEXT_PI})
    m = re.search(r"/workitemtypes/([^/?]+)/fields\?", u)
    if m: return J({"value": META["typeFields"][unquote(m.group(1))]})
    if re.search(r"/workitemtypes/[^/?]+/states\?", u): return J({"value": []})
    if re.search(r"/_apis/wit/workitemtypes\?", u): return J({"value": META["workitemtypes"]})
    if re.search(r"/work/processes/[^/]+/workitemtypes\?", u): return J({"value": META["processWits"]})
    if re.search(r"/workItemTypes/[^/?]+/rules\?", u): return J({"value": []})
    m = re.search(r"/workItemTypes/([^/?]+)/layout\?", u)
    if m: return J(META["layouts"][next(w["name"] for w in META["processWits"] if w["referenceName"] == m.group(1))])
    if re.search(r"/_apis/wit/workitems\?ids=800001", u): return J({"value": [EPIC]})
    m = re.search(r"/_apis/wit/workitems/\$([^?]+)\?", u)
    if m and req.method == "POST":
        ops = json.loads(req.post_data); typ = unquote(m.group(1))
        f = {"System.WorkItemType": typ, "System.TeamProject": "Portfolio Merkava", "System.State": "New"}
        for o in ops:
            if o["path"].startswith("/fields/"): f[o["path"][8:]] = o["value"]
        posts.append({"type": typ, "ops": ops, "auth": req.all_headers().get("authorization")})
        if fail_title["v"] and f.get("System.Title") == fail_title["v"]: return J({"message": "TF401320: Rule Error for field Leading Squad. Error code: Required, HasValues, InvalidEmpty."}, 400)
        i = nid["v"]; nid["v"] += 1
        return J({"id": i, "rev": 1, "url": "https://dev.azure.com/GOI-Finance/p/_apis/wit/workItems/" + str(i), "fields": f, "relations": []})
    return J({"value": []}) if "/_apis/wit/wiql" in u else J({"message": "not mocked " + u}, 404)

with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1300, "height": 900}); ctx.route("https://dev.azure.com/**", handler)
    ctx.route("**/team-config.json*", lambda route, req: route.fulfill(status=200, json=CFG))
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8809/"); pg.fill("#pat", PAT); pg.click("#patBtn"); pg.locator("#app:not(.hidden)").wait_for()
    breakdown(pg)
    pg.check('input[name="bcEpicQ"][value="1"]'); pg.fill("#bcEpic", "800001"); pg.locator("#bcEpicInfo.parentcard").wait_for(timeout=5000)
    area = pg.locator("#bcBody .bc-sec").first.locator(".eprow", has=pg.locator("label", has_text="Area")).locator(".pk-btn").inner_text()
    check("api: Feature takes the Epic's area", "Meteor" in area, area)
    fill_all(pg)
    second = pg.locator(".bc-us").nth(1).locator(".bc-us-top .bc-title").input_value()
    fail_title["v"] = second
    n_tasks_2nd = pg.locator(".bc-us").nth(1).locator(".bc-task").count()
    pg.click("#bcGo"); pg.click("#bcYes"); pg.locator(".bc-done").wait_for(timeout=30000)
    fp = posts[0]; fops = {o["path"]: o.get("value") for o in fp["ops"]}
    check("api: Feature first, linked to the Epic", fp["type"] == "Feature" and any(o["path"] == "/relations/-" and o["value"]["url"].endswith("/800001") and o["value"]["rel"] == "System.LinkTypes.Hierarchy-Reverse" for o in fp["ops"]), fp["ops"])
    check("api: Feature fields", fops.get("/fields/System.Tags") == "אז'ורי-פירוק" and fops.get("/fields/Custom.StoryPointsValues") == "03 = 2-4d" and fops.get("/fields/Custom.LeadingSquad") == "Meteor", fops)
    us_posts = [x for x in posts if x["type"] == "User Story"]
    check("api: US linked to the new Feature", all(any(o["path"] == "/relations/-" and o["value"]["url"].endswith("/700001") for o in x["ops"]) for x in us_posts), us_posts[:1])
    t_posts = [x for x in posts if x["type"] == "Task"]
    check("api: Tasks carry Original Estimate", t_posts and all(any(o["path"] == "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate" for o in x["ops"]) for x in t_posts))
    done = pg.locator(".bc-done").inner_text()
    check("api: failed US reported, its tasks skipped, the rest created", "לא נוצרו" in done and second in done and "Leading Squad" in done and done.count("לא נוצר כי ה-US נכשל") == n_tasks_2nd, done[-500:])
    check("api: links to Azure in the summary", pg.locator(".bc-done a[href*='/_workitems/edit/700001']").count() == 1)
    check("api: token only to Azure DevOps", all(x["auth"] == AUTH for x in posts))
    # Feature failure: nothing else created
    n = len(posts)
    breakdown(pg); pg.check('input[name="bcEpicQ"][value="0"]'); fill_all(pg)
    fail_title["v"] = pg.locator(".bc-feat .bc-title").first.input_value()
    pg.click("#bcGo"); pg.click("#bcYes"); pg.wait_for_timeout(1500)
    check("api: Feature fails -> stop, panel stays open with the reason", len(posts) == n + 1 and pg.is_visible("#bcPanel") and "לא נוצר שום פריט" in pg.inner_text("#bcCheck"), pg.inner_text("#bcCheck"))
    pg.click("#bcClose")
    # next PI not in Azure yet: stop and explain
    breakdown(pg); pg.check('input[name="bcEpicQ"][value="0"]'); fill_all(pg)
    pg.select_option("#bcFirst", "2"); pg.wait_for_timeout(600)
    chk = pg.inner_text("#bcCheck"); lost = pg.locator(".bc-warn:visible").count()
    check("api: next PI missing -> stop and explain, US marked", "ה-PI הבא עוד לא קיים" in chk and lost >= 1 and pg.locator("#bcGo").is_disabled(), chk)
    for i in range(pg.locator(".bc-us").count()):
        c = pg.locator(".bc-us").nth(i)
        if c.locator(".bc-warn:visible").count(): c.locator(".bc-us-top input[type=checkbox]").uncheck()
    pg.wait_for_timeout(600)
    check("api: unchecking them unblocks", "הכל מוכן" in pg.inner_text("#bcCheck") and pg.locator(".bc-feat").count() == 1, pg.inner_text("#bcCheck"))
    check("api: no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
