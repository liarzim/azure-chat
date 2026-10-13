"""Regression for the Azure Chat 1.3 features under the production headers."""
import os, sys, zipfile, io, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:300]))
    if not c: fails.append(n)
PICKER = """window.__saved=null; window.showSaveFilePicker = async (o) => ({name:o.suggestedName, createWritable: async()=>({write: async b=>{ window.__saved = b; document.documentElement.dataset.saved = '1'; }, close: async()=>{} })});"""
srv = start(8783)
with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(accept_downloads=True); ctx.add_init_script(PICKER); ctx.grant_permissions(["clipboard-read", "clipboard-write"])
    pg = ctx.new_page(); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8783/"); pg.click("#demoBtn")
    pg.fill("#input", "110047, 112074, 112079"); pg.keyboard.press("Enter"); pg.locator(".msg.bot table").first.wait_for()
    t = pg.locator(".msg.bot table").first
    check("3 rows (one missing)", t.locator("tbody tr").count() == 3 and "112079" in pg.locator(".msg.bot .notes").last.inner_text())
    pg.locator("img.thumb").first.wait_for(timeout=10000)
    check("images shown", pg.locator("img.thumb").count() >= 2)
    pg.locator("img.thumb").first.click(); check("lightbox", pg.locator("#lightbox").is_visible()); pg.keyboard.press("Escape")
    pg.fill("#input", "110047 רק Title ו-State"); pg.keyboard.press("Enter"); pg.wait_for_timeout(800)
    check("column filter", pg.locator(".msg.bot table").last.locator("th").count() == 3)
    pg.locator("button:has-text('הורדה ל-Excel')").first.click(); pg.locator("html[data-saved]").wait_for(state="attached", timeout=15000)
    b64 = pg.evaluate("async()=>{const b=new Uint8Array(await window.__saved.arrayBuffer());let s='';for(let i=0;i<b.length;i+=8192)s+=String.fromCharCode(...b.subarray(i,i+8192));return btoa(s);}")
    z = zipfile.ZipFile(io.BytesIO(base64.b64decode(b64)))
    check("excel with embedded images", any(n.startswith("xl/media/") for n in z.namelist()) and "xl/worksheets/sheet1.xml" in z.namelist())
    pg.locator("button:has-text('העתקת טבלה')").first.click(); pg.locator("#toast:has-text('הועתקה')").wait_for(timeout=15000)
    html = pg.evaluate("async()=>{const it=(await navigator.clipboard.read())[0];return await (await it.getType('text/html')).text();}")
    check("copy includes images", "data:image/jpeg" in html)
    # send by email: a menu of mail apps
    from urllib.parse import urlparse, parse_qs
    import email
    from email import policy
    pg.evaluate("window.openMailto = u => { window.__mail = u; }; 0")
    mb = pg.locator(".msg.bot button:has-text('שליחה במייל')").first
    mb.click()
    menu = pg.locator(".mailmenu:visible")
    check("mail: menu with Outlook, Gmail, other", menu.count() == 1 and menu.locator("button").count() == 3, menu.count())
    with pg.expect_download() as dl:
        menu.locator("button[data-client=outlook]").click()
    eml = open(dl.value.path(), "rb").read()
    msg = email.message_from_bytes(eml, policy=policy.default)
    check("outlook: .eml draft file", dl.value.suggested_filename.endswith(".eml") and msg["X-Unsent"] == "1", dl.value.suggested_filename)
    subj = str(msg["Subject"])
    check("outlook: subject from the table", subj.startswith("אז'ורי: 2 פריטים (") and "110047" in subj and "112074" in subj, subj)
    htmlp = msg.get_body(("html",)); html = htmlp.get_content()
    check("outlook: HTML body, two blank lines then a real table", "<p>&nbsp;</p><p>&nbsp;</p><table" in html and "<th" in html and "110047" in html and "112074" in html, html[:300])
    cids = [p for p in msg.walk() if p["Content-ID"]]
    check("outlook: images embedded as attachments (cid)", len(cids) >= 1 and "cid:" in html and "data:image" not in html, len(cids))
    check("outlook: menu closed after choosing", pg.locator(".mailmenu:visible").count() == 0)
    mb.click(); pg.locator(".mailmenu:visible button[data-client=gmail]").click(); pg.wait_for_timeout(1500)
    url = pg.evaluate("window.__mail") or ""; q = parse_qs(urlparse(url).query)
    check("gmail: compose window with subject and two blank lines", url.startswith("https://mail.google.com/mail/?view=cm") and q.get("su", [""])[0] == subj and q.get("body", [""])[0] == "\r\n\r\n", url[:150])
    cb = pg.evaluate("async()=>{const it=(await navigator.clipboard.read())[0];return await (await it.getType('text/html')).text();}")
    check("gmail: formatted table copied for Ctrl+V", "<table" in cb and "110047" in cb)
    check("gmail: toast explains the paste", "Ctrl+V" in pg.inner_text("#toast"), pg.inner_text("#toast"))
    check("last choice is marked", pg.locator(".mailmenu button[data-client=gmail].last").count() >= 1)
    pg.evaluate("window.__mail = ''; 0")
    mb.click(); pg.locator(".mailmenu:visible button[data-client=other]").click(); pg.wait_for_timeout(1000)
    url = pg.evaluate("window.__mail") or ""
    check("other: default mail app (mailto) with the subject", url.startswith("mailto:?subject=") and "body=%0D%0A%0D%0A" in url, url[:120])
    one = pg.evaluate("mailSubject({cols:[{label:'ID',ref:'id'},{label:'Work Item Type',ref:'System.WorkItemType'},{label:'Title',ref:'System.Title'}],rows:[{id:5,cells:['5','Bug','שגיאה במסך']}],missing:[]})")
    check("mail: one item subject has type, id and title", one == "אז'ורי: Bug 5 - שגיאה במסך", one)
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
