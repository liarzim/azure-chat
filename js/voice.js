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
    field.dataset.mic = "own";
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "btn ghost mic";
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
    btn.title = "הקלדה בדיבור (עברית)"; btn.setAttribute("aria-label", "הקלדה בדיבור" + (label ? ": " + label : ""));
    btn.setAttribute("aria-pressed", "false");
    btn.onclick = () => (this.active && this.active.btn === btn) ? this.stop(true) : this.start(field, btn);
    place(btn);
    return btn;
  },

  isRich(field) { return field.isContentEditable; },
  start(field, btn) {
    this.stop();
    let rec;
    try { rec = new this.Rec(); } catch (e) { toast("הדפדפן לא מאפשר הקלטה כאן"); return; }
    rec.lang = "he-IL"; rec.continuous = true; rec.interimResults = true;
    const rich = this.isRich(field);
    // text fields: spoken words go where the cursor is (after what is already written), shown live
    let before = "", after = "";
    if (!rich) {
      const v = field.value || "", end = typeof field.selectionStart === "number" && document.activeElement === field ? field.selectionStart : v.length;
      before = v.slice(0, end); after = v.slice(end);
      if (before && !/\s$/.test(before)) before += " ";
    }
    let done = "";
    rec.onresult = ev => {
      if (!this.active || this.active.rec !== rec) return;      // aborted (message sent, dialog closed)
      let interim = "", fin = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i], t = r[0] ? r[0].transcript : "";
        if (r.isFinal) fin += t.trim() + " "; else interim += t;
      }
      if (rich) {                                   // rich text (Description): insert final words at the cursor
        if (fin) { field.focus(); document.execCommand("insertText", false, fin); }
        this.hint(interim);
        return;
      }
      done += fin;
      const mid = (done + interim).replace(/\s+$/, interim ? "" : " ");
      field.value = before + mid + after;
      try { const pos = (before + mid).length; field.setSelectionRange(pos, pos); } catch (e) {}
      field.dispatchEvent(new Event("input", {bubbles: true}));
    };
    rec.onerror = ev => {
      const why = {"not-allowed": "אין הרשאה למיקרופון. אשרו גישה בסמל המנעול שליד כתובת האתר.", "service-not-allowed": "זיהוי הדיבור חסום בדפדפן הזה.",
        "no-speech": "לא נשמע דיבור. נסו שוב.", "audio-capture": "לא נמצא מיקרופון.", "network": "אין חיבור לשירות זיהוי הדיבור של הדפדפן."}[ev.error];
      if (why) toast(why);
    };
    rec.onend = () => { if (this.active && this.active.rec === rec) this.finish(); };
    this.active = {rec, btn, field, rich};
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
    if (!a.rich) { a.field.value = a.field.value.replace(/\s+$/, ""); a.field.dispatchEvent(new Event("input", {bubbles: true})); }
    this.hint("");
    if (a.btn === this.fbtn) this.place();
  },

  /* ---------- one floating 🎤 for every other place you can write ---------- */
  fbtn: null, ffield: null, bubble: null,
  eligible(el) {
    if (!el || el.dataset && el.dataset.mic) return false;
    if (el.closest && el.closest("#login")) return false;                       // sign-in: tokens only
    if (el.isContentEditable) return el.getAttribute("contenteditable") === "true";
    if (el.tagName === "TEXTAREA") return !el.readOnly && !el.disabled;
    if (el.tagName !== "INPUT" || el.readOnly || el.disabled) return false;
    const t = (el.getAttribute("type") || "text").toLowerCase();
    return (t === "text" || t === "search") && el.autocomplete !== "new-password";
  },
  place() {
    const b = this.fbtn, f = this.ffield;
    if (!b) return;
    const recOn = this.active && this.active.btn === b;
    if (!f || !document.contains(f) || (!recOn && document.activeElement !== f)) { b.classList.add("hidden"); return; }
    const r = f.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) { b.classList.add("hidden"); return; }
    const size = 30, multi = f.tagName === "TEXTAREA" || f.isContentEditable;
    const top = multi ? r.top + 4 : r.top + (r.height - size) / 2;
    // inside the field, at the end where the text does not start (left for Hebrew, right for LTR fields)
    const ltr = getComputedStyle(f).direction === "ltr";
    const left = ltr ? r.right - size - 6 : r.left + 6;
    b.style.top = Math.max(4, top) + "px"; b.style.left = left + "px";
    b.classList.remove("hidden");
    if (this.bubble && !this.bubble.classList.contains("hidden")) { this.bubble.style.top = (Math.max(4, top) + size + 4) + "px"; this.bubble.style.left = Math.max(4, left) + "px"; }
  },
  hint(text) {
    if (!this.bubble) return;
    this.bubble.textContent = text || "";
    this.bubble.classList.toggle("hidden", !text);
    if (text) this.place();
  },
  initFloating() {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn mic mic-float hidden";
    b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>';
    b.title = "הקלדה בדיבור (עברית)"; b.setAttribute("aria-label", "הקלדה בדיבור"); b.setAttribute("aria-pressed", "false");
    b.addEventListener("mousedown", e => e.preventDefault());            // keep the cursor in the field
    b.onclick = () => {
      if (this.active && this.active.btn === b) return this.stop(true);
      if (this.ffield) this.start(this.ffield, b);
    };
    document.body.appendChild(b); this.fbtn = b;
    const bub = document.createElement("div"); bub.className = "mic-bubble hidden"; bub.setAttribute("aria-live", "polite");
    document.body.appendChild(bub); this.bubble = bub;
    document.addEventListener("focusin", e => {
      const el = e.target;
      if (el === b) return;
      if (this.eligible(el)) {
        if (this.active && this.active.btn === b && this.active.field !== el) this.stop();
        this.ffield = el;
      } else if (!(this.active && this.active.btn === b)) this.ffield = null;
      this.place();
    });
    document.addEventListener("focusout", () => setTimeout(() => {
      const a = this.active;
      if (a && a.btn === b && document.activeElement !== a.field && document.activeElement !== b) this.stop(true);
      this.place();
    }, 150));
    addEventListener("scroll", () => this.place(), true);
    addEventListener("resize", () => this.place());
  },

  init() {
    if (!this.supported()) return;
    this.initFloating();
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
