"use strict";
/* ============================================================
   Voice typing (🎤): Hebrew speech to text into a text field.
   Uses the browser's own speech recognition (Chrome, Edge).
   The browser's provider does the recognition (Google in Chrome,
   Microsoft in Edge); Azuri keeps nothing and sends nothing itself.
   Where the browser has no speech recognition the button is not shown.
   ============================================================ */

const Voice = {
  Rec: typeof window !== "undefined" ? (window.SpeechRecognition || window.webkitSpeechRecognition || null) : null,
  active: null,            // {rec, btn, field}

  supported() { return !!this.Rec; },

  /* Adds a mic button for a text field. place(btn) puts it on the page. */
  attach(field, place, label) {
    if (!this.supported() || !field) return null;
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn ghost mic";
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
    btn.title = "הקלדה בדיבור (עברית)"; btn.setAttribute("aria-label", "הקלדה בדיבור" + (label ? ": " + label : ""));
    btn.setAttribute("aria-pressed", "false");
    btn.onclick = () => (this.active && this.active.btn === btn) ? this.stop(true) : this.start(field, btn);
    place(btn);
    return btn;
  },

  start(field, btn) {
    this.stop();
    let rec;
    try { rec = new this.Rec(); } catch (e) { toast("הדפדפן לא מאפשר הקלטה כאן"); return; }
    rec.lang = "he-IL"; rec.continuous = true; rec.interimResults = true;
    // keep what was typed; spoken text goes after it
    const base = field.value && !/\s$/.test(field.value) ? field.value + " " : field.value;
    let done = "";
    rec.onresult = ev => {
      if (!this.active || this.active.rec !== rec) return;      // aborted (message sent, dialog closed)
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i], t = r[0] ? r[0].transcript : "";
        if (r.isFinal) done += t.trim() + " "; else interim += t;
      }
      field.value = (base + done + interim).replace(/\s+$/, interim ? "" : " ");
      field.dispatchEvent(new Event("input", {bubbles: true}));
    };
    rec.onerror = ev => {
      const why = {"not-allowed": "אין הרשאה למיקרופון. אשרו גישה בסמל המנעול שליד כתובת האתר.", "service-not-allowed": "זיהוי הדיבור חסום בדפדפן הזה.",
        "no-speech": "לא נשמע דיבור. נסו שוב.", "audio-capture": "לא נמצא מיקרופון.", "network": "אין חיבור לשירות זיהוי הדיבור של הדפדפן."}[ev.error];
      if (why) toast(why);
    };
    rec.onend = () => { if (this.active && this.active.rec === rec) this.finish(); };
    this.active = {rec, btn, field};
    btn.classList.add("rec"); btn.setAttribute("aria-pressed", "true"); btn.title = "עצירת ההקלטה";
    try { rec.start(); } catch (e) { this.finish(); toast("לא ניתן להתחיל הקלטה"); return; }
    field.focus();
  },
  /* gentle = the mic button: let the last words arrive, then end. Otherwise drop the rest now. */
  stop(gentle) {
    const a = this.active; if (!a) return;
    if (gentle) { try { a.rec.stop(); } catch (e) { this.finish(); } a.btn.classList.remove("rec"); return; }
    try { a.rec.abort(); } catch (e) {}
    this.finish();
  },
  finish() {
    const a = this.active; if (!a) return;
    this.active = null;
    a.btn.classList.remove("rec"); a.btn.setAttribute("aria-pressed", "false"); a.btn.title = "הקלדה בדיבור (עברית)";
    a.field.value = a.field.value.replace(/\s+$/, "");
    a.field.dispatchEvent(new Event("input", {bubbles: true}));
  },

  init() {
    if (!this.supported()) return;
    const input = $("input");
    this.attach(input, b => $("sendBtn").before(b), "הודעה לאז'ורי");
    $("composer").addEventListener("submit", () => this.stop(), true);
    [["bdText", "תיאור הפיצ'ר"], ["bdValue", "ערך ללקוח"]].forEach(([id, label]) => {
      const f = $(id); if (!f) return;
      const wrap = document.createElement("div"); wrap.className = "micwrap";
      f.before(wrap); wrap.appendChild(f);
      this.attach(f, b => wrap.appendChild(b), label);
    });
    const dlgClose = () => { if (this.active && /^bd/.test(this.active.field.id)) this.stop(); };
    ["bdGo", "bdCancel"].forEach(id => { const b = $(id); if (b) b.addEventListener("click", dlgClose, true); });
  }
};

document.addEventListener("DOMContentLoaded", () => Voice.init());
