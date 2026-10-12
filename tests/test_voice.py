"""Voice typing (🎤): a fake browser speech recognizer drives the chat box and the breakdown dialog."""
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from server import start, ROOT
from playwright.sync_api import sync_playwright
fails = []
def check(n, c, i=""):
    print(("PASS " if c else "FAIL ") + n + ("" if c else "  -> " + str(i)[:500]))
    if not c: fails.append(n)
srv = start(8822)
FAKE = """
window.__recs = [];
class FakeRec {
  constructor() { this.lang = ''; window.__recs.push(this); }
  start() { this.started = true; }
  stop() { this.stopped = true; setTimeout(() => this.onend && this.onend(), 10); }
  abort() { this.aborted = true; setTimeout(() => this.onend && this.onend(), 10); }
  say(text, final) { const r = [{transcript: text}]; r.isFinal = !!final; this.onresult({resultIndex: 0, results: [r]}); }
  fail(code) { this.onerror({error: code}); }
}
window.webkitSpeechRecognition = FakeRec; window.SpeechRecognition = FakeRec;
"""
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1200, "height": 800}); ctx.add_init_script(FAKE)
    pg = ctx.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto("http://127.0.0.1:8822/"); pg.click("#demoBtn"); pg.wait_for_timeout(300)
    mic = pg.locator("#composer .btn.mic")
    check("mic button next to the chat box", mic.count() == 1 and mic.is_visible())
    pg.fill("#input", "110047")
    mic.click()
    check("recording: Hebrew, continuous, button shows it", pg.evaluate("window.__recs[0].lang") == "he-IL" and pg.evaluate("window.__recs[0].started") and mic.get_attribute("aria-pressed") == "true" and "rec" in mic.get_attribute("class"))
    pg.evaluate("window.__recs[0].say('רק טייטל', false)")
    check("interim words appear after what was typed", pg.input_value("#input") == "110047 רק טייטל", pg.input_value("#input"))
    pg.evaluate("window.__recs[0].say('רק Title ו-State', true)")
    mic.click(); pg.wait_for_timeout(100)
    check("stop: final text kept, button back to normal", pg.input_value("#input") == "110047 רק Title ו-State" and mic.get_attribute("aria-pressed") == "false" and pg.evaluate("window.__recs[0].stopped"), pg.input_value("#input"))
    mic.click(); pg.evaluate("window.__recs[1].say('עזרה', true)")
    pg.keyboard.press("Enter"); pg.wait_for_timeout(300)
    check("sending stops the recording", pg.evaluate("window.__recs[1].aborted") and mic.get_attribute("aria-pressed") == "false")
    pg.evaluate("window.__recs[1].say('לא אמור להיכנס', true)")
    check("words after sending are ignored", pg.input_value("#input") == "", pg.input_value("#input"))
    # breakdown dialog: feature text and value
    pg.click("#bdBtn")
    mics = pg.locator("#bdDlg .btn.mic")
    check("mic buttons for the feature text and the business value", mics.count() == 2)
    mics.nth(0).click(); n = pg.evaluate("window.__recs.length") - 1
    pg.evaluate(f"window.__recs[{n}].say('מסך שבו החשב רואה את המוסדות', true)")
    check("dictation fills the feature text", pg.input_value("#bdText") == "מסך שבו החשב רואה את המוסדות ", pg.input_value("#bdText"))
    mics.nth(1).click(); n2 = pg.evaluate("window.__recs.length") - 1
    check("starting another field stops the first", pg.evaluate(f"window.__recs[{n}].aborted") and mics.nth(1).get_attribute("aria-pressed") == "true")
    pg.evaluate(f"window.__recs[{n2}].fail('not-allowed')"); pg.wait_for_timeout(100)
    check("no mic permission explained", "הרשאה למיקרופון" in pg.inner_text("#toast"), pg.inner_text("#toast"))
    pg.click("#bdCancel")
    check("closing the dialog stops recording", pg.evaluate(f"window.__recs[{n2}].aborted") or pg.evaluate(f"window.__recs[{n2}].stopped"))
    check("no js errors", not errs, errs)
    # a browser without speech recognition: no buttons
    ctx2 = b.new_context(); ctx2.add_init_script("delete window.webkitSpeechRecognition; delete window.SpeechRecognition;")
    pg2 = ctx2.new_page(); pg2.goto("http://127.0.0.1:8822/"); pg2.click("#demoBtn"); pg2.wait_for_timeout(300)
    check("no speech recognition: no mic buttons", pg2.locator(".btn.mic").count() == 0 and pg2.locator("#bdText").count() == 1)
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(200)
    check("phone: no horizontal scroll", pg.evaluate("document.documentElement.scrollWidth") <= 390, pg.evaluate("document.documentElement.scrollWidth"))
    b.close()
srv.shutdown()
print("FAILURES:", fails); sys.exit(1 if fails else 0)
