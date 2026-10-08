"""Typing under template headings: text stays plain, and a blank line stays before each heading."""
import os, sys, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:700]))
    if not c: fails.append(n)
srv = start(8784)
HEAD_RGB = "rgb(0, 51, 204)"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={"width": 1400, "height": 900}); errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8784/"); pg.click("#demoBtn")
    pg.fill("#input", "112075"); pg.keyboard.press("Enter"); pg.locator(".msg.bot table").first.wait_for()
    hdr = [h.inner_text() for h in pg.locator(".msg.bot table").first.locator("th").all()]
    pg.locator(".msg.bot table").first.locator("tbody tr").nth(0).locator("td").nth(hdr.index("Description")).click()
    area = pg.locator("#epFields .rich.big"); area.wait_for()
    check("opening the editor alone is not a change", "עוד אין שינויים" in pg.inner_text("#epCheck"), pg.inner_text("#epCheck"))
    def type_under(heading, text):
        h = area.locator("div", has_text=heading).first
        box = h.bounding_box()
        pg.mouse.click(box["x"] + 3, box["y"] + box["height"] / 2)   # RTL: the end of the line is on the left
        pg.keyboard.press("End"); pg.keyboard.press("Enter"); pg.keyboard.type(text)
    type_under("ערך ללקוח", "111")
    # click straight on the empty line under a heading and type
    ph = pg.evaluate("""() => { const a = document.querySelector('#epFields .rich.big'); const h = [...a.children].find(x => x.textContent.includes('פיתרון ארכיטקט')); const r = h.nextElementSibling.getBoundingClientRect(); return {x: r.x + r.width - 20, y: r.y + r.height / 2}; }""")
    pg.mouse.click(ph["x"], ph["y"]); pg.keyboard.type("333")
    type_under("תלויות בצוותים אחרים", "222")
    pg.wait_for_timeout(300)
    info = pg.evaluate("""() => {
      const a = document.querySelector('#epFields .rich.big');
      const out = {};
      for (const t of ['111', '222', '333']) {
        const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT); let n, found = null;
        while ((n = w.nextNode())) if (n.nodeValue.includes(t)) { found = n; break; }
        if (!found) { out[t] = 'missing'; continue; }
        const el = found.parentElement, cs = getComputedStyle(el);
        out[t] = {weight: cs.fontWeight, color: cs.color, underline: cs.textDecorationLine, tagChain: (() => { let s = [], x = el; while (x && x !== a) { s.push(x.tagName); x = x.parentElement; } return s.join('<'); })()};
      }
      return out;
    }""")
    for t in ("111", "222", "333"):
        st = info[t]
        check("typed '%s' is plain (not bold, not underlined, not heading colour)" % t, isinstance(st, dict) and int(st["weight"]) < 600 and "underline" not in st["underline"] and st["color"] != HEAD_RGB, st)
    pg.locator("#epSave").wait_for(); pg.wait_for_timeout(300)
    pg.click("#epSave"); pg.locator(".msg.bot.ok").first.wait_for()
    saved = pg.evaluate("() => DemoDB.get(112075).fields['System.Description']")
    lines = pg.evaluate("""(h) => { const d = document.createElement('div'); d.innerHTML = h; return [...d.children].map(x => x.textContent.trim()); }""", saved)
    def gap_before(head):
        i = next(k for k, l in enumerate(lines) if l.startswith(head))
        return lines[i - 1] == ""
    check("blank line between my text and the next heading", gap_before("Feature Specific") and gap_before("QA-"), lines)
    check("saved text present", "111" in lines and "222" in lines, lines)
    # Repair of a description saved before the fix (looks like the screenshot)
    bad = ('<div><b><u><span style="color:#0033CC">תאור הדרישה:</span></u></b></div><div><b><u><span style="color:#0033CC">111</span></u></b></div>'
           '<div><b><u><span style="color:#0033CC">ערך ללקוח:</span></u></b></div><div><b><u><span style="color:#0033CC">111</span></u></b></div>'
           '<div><b><u><span style="color:#0033CC">Feature Specific ACCEPTENCE CRATIRIA (What to Demo?):</span></u></b></div><div><br></div>')
    pg.evaluate("(h) => { const it = DemoDB.map.get(112075); it.fields['System.Description'] = h; }", bad)
    pg.fill("#input", "112075"); pg.keyboard.press("Enter"); pg.locator(".msg.bot table").nth(1).wait_for()
    pg.locator(".msg.bot table").nth(1).locator("tbody tr").nth(0).locator("td").nth(hdr.index("Description")).click()
    pg.locator("#epFields .rich.big").wait_for(); pg.wait_for_timeout(300)
    check("old formatting detected as a fix to save", "Description" in pg.inner_text("#epCheck") and pg.locator("#epSave").is_enabled(), pg.inner_text("#epCheck"))
    pg.click("#epSave"); pg.locator(".msg.bot.ok").nth(1).wait_for()
    fixed = pg.evaluate("() => DemoDB.get(112075).fields['System.Description']")
    check("old description repaired", fixed.count('color:#0033CC') == 3 and re.search(r'<div style="direction: ?rtl;?">111</div><div style="direction: ?rtl;?"><br></div><div style="direction: ?rtl;?"><b><u><span style="color:#0033CC">ערך', fixed) is not None, fixed)
    allblocks = pg.evaluate("(h) => { const d = document.createElement('div'); d.innerHTML = h; return [...d.children].every(x => x.style.direction === 'rtl'); }", fixed)
    check("every line saved right-to-left", allblocks, fixed[:400])
    first = pg.evaluate("() => DemoDB.get(112075).fields['System.Description']")
    check("no js errors", not errs, errs)
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
