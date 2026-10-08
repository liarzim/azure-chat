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
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
