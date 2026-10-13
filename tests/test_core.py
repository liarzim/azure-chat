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
    b = p.chromium.launch(); ctx = b.new_context(); ctx.add_init_script(PICKER); ctx.grant_permissions(["clipboard-read", "clipboard-write"])
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
    # send by email: mailto with an auto subject, two blank lines, then the table
    from urllib.parse import urlparse, parse_qs
    pg.evaluate("window.openMailto = u => { window.__mail = u; }; 0")
    pg.locator(".msg.bot button:has-text('שליחה במייל')").first.click(); pg.wait_for_timeout(1500)
    url = pg.evaluate("window.__mail") or ""
    q = parse_qs(urlparse(url).query)
    subj, body = q.get("subject", [""])[0], q.get("body", [""])[0]
    check("mail: opens a new message", url.startswith("mailto:?"), url[:120])
    check("mail: subject from the table", subj.startswith("אז'ורי: 2 פריטים (") and "110047" in subj and "112074" in subj, subj)
    check("mail: two blank lines, then the header row", body.startswith("\r\n\r\n") and body[4:].startswith("ID | "), repr(body[:60]))
    check("mail: all found rows in the body within a safe link length", "110047" in body and "112074" in body and "112079" in body and len(url) <= 1900, (len(url), body[:600]))
    check("mail: long columns dropped and named", "Description" not in body.split("\r\n")[2] and "עמודות הטקסט הארוך" in body, body[-200:])
    check("mail: toast explains the formatted paste", "נפתח מייל" in pg.inner_text("#toast"), pg.inner_text("#toast"))
    one = pg.evaluate("mailSubject({cols:[{label:'ID',ref:'id'},{label:'Work Item Type',ref:'System.WorkItemType'},{label:'Title',ref:'System.Title'}],rows:[{id:5,cells:['5','Bug','שגיאה במסך']}],missing:[]})")
    check("mail: one item subject has type, id and title", one == "אז'ורי: Bug 5 - שגיאה במסך", one)
    big = pg.evaluate("(() => { const rows = []; for (let i = 0; i < 60; i++) rows.push({id:i, cells:[String(i), 'כותרת ארוכה מאוד לבדיקה של אורך הקישור ' + i]}); return mailtoFor({cols:[{label:'ID',ref:'id'},{label:'Title',ref:'System.Title'}], rows, missing:[]}); })()")
    check("mail: long table is cut to a safe length and says so", len(big["url"]) <= 1900 and big["cut"] > 0 and "%D7" in big["url"], big["cut"])
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
