"use strict";
/* ============================================================
   Feature breakdown screen (פירוק פיצ'ר), stage 1: show only.
   The dialog asks the skill's two questions (business value, UI/UX),
   the result is shown in the chat as cards, and can be copied,
   downloaded (CSV / Excel), improved with any approved AI chat
   (copy the prompt, paste the answer back), or sent to an existing
   agent named in team-config.json (breakdownAgent: {url, label}).
   Nothing is written to Azure DevOps here.
   ============================================================ */

const BreakdownUI = {
  CMD: /^\s*(פרק|פרקי|פירוק(?:\s+פיצ['׳]?ר)?|breakdown)\s*[:：]\s*/i,
  ENGINE_LABEL: {rules: "כללים פנימיים", ai: "שופר עם AI", agent: "סוכן"},
  last: null,

  match(text) { return this.CMD.test(text); },
  fromChat(text) { return String(text || "").replace(this.CMD, "").trim(); },

  agentCfg() {
    const a = typeof TeamConfig !== "undefined" && TeamConfig.data ? TeamConfig.data.breakdownAgent : null;
    return a && /^https:\/\/\S+$/i.test(a.url || "") && !/dev\.azure\.com|visualstudio\.com/i.test(a.url) ? a : null;
  },

  /* ---------- the dialog ---------- */
  open(pre) {
    pre = pre || {};
    const last = this.last ? this.last.input : {};
    $("bdText").value = pre.text != null && pre.text !== "" ? pre.text : (pre.keep ? last.text || "" : "");
    $("bdValue").value = pre.value != null ? pre.value : (pre.keep ? last.value || "" : "");
    $("bdRole").value = pre.role != null ? pre.role : (pre.keep ? last.role || "" : "");
    const ui = pre.ui != null ? pre.ui : (pre.keep ? last.ui : null);
    document.querySelectorAll('input[name="bdUi"]').forEach(r => { r.checked = ui != null && r.value === (ui ? "1" : "0"); });
    this.err("");
    $("bdDlg").classList.remove("hidden");
    ($("bdText").value ? $("bdValue") : $("bdText")).focus();
  },
  close() { $("bdDlg").classList.add("hidden"); $("input").focus(); },
  err(msg, focusId) {
    const e = $("bdErr"); e.textContent = msg; e.classList.toggle("hidden", !msg);
    if (focusId) $(focusId).focus();
  },
  submit() {
    const text = $("bdText").value.trim(), value = $("bdValue").value.trim(), role = $("bdRole").value.trim();
    const uiEl = document.querySelector('input[name="bdUi"]:checked');
    if (text.length < 8) return this.err("כתבו בכמה מילים מה הפיצ'ר צריך לעשות.", "bdText");
    if (value.length < 3) return this.err("מה הערך העסקי ללקוח? זו שאלה מחייבת, כי ממנה נגזרים התעדוף וה-\"כך ש...\" בכל User Story.", "bdValue");
    if (!uiEl) return this.err("סמנו אם נדרש UI/UX (כן/לא).", null);
    const input = {text, value, role, ui: uiEl.value === "1"};
    this.close();
    addMsg("user", escHtml("פירוק פיצ'ר: " + BreakdownEngine.firstSentence(text, 90)));
    let b;
    try { b = BreakdownEngine.rules(input); }
    catch (e) { addMsg("bot error", "הפירוק נכשל: " + escHtml(e.message || String(e))); return; }
    this.render(b, input);
  },

  /* ---------- the result ---------- */
  render(b, input, el) {
    this.last = {b, input};
    if (!el) el = addMsg("bot", "");
    el.innerHTML = "";
    const card = document.createElement("div"); card.className = "bd";
    const n = b.stories.length;

    const head = document.createElement("div"); head.className = "bd-head";
    head.innerHTML = '<div class="bd-title">פירוק פיצ\'ר: <b>' + escHtml(b.feature.title) + "</b></div>" +
      '<div class="bd-stats"><span class="bd-pill">' + n + " User Stories</span>" +
      '<span class="bd-pill">סך הכל ' + b.totalSp + " SP</span>" +
      '<span class="bd-pill" title="לפי ה-Skill, הערכת הפיצ\'ר מתחילה תמיד מ-3">פיצ\'ר: ' + b.feature.sp + " SP</span>" +
      '<span class="bd-pill bd-eng">' + escHtml(this.ENGINE_LABEL[b.engine] || b.engine) + "</span></div>" +
      (b.feature.value ? '<div class="bd-value"><span>ערך ללקוח:</span> ' + escHtml(b.feature.value) + "</div>" : "");
    card.appendChild(head);

    const plan = document.createElement("div"); plan.className = "bd-plan";
    plan.innerHTML = "<b>תכנון ספרינטים:</b> " + b.sprints.map((ix, k) =>
      '<span class="bd-sprint">ספרינט ' + (k + 1) + ": US " + ix.map(i => i + 1).join(", ") + " · " + ix.reduce((s, i) => s + b.stories[i].sp, 0) + " SP</span>").join("");
    card.appendChild(plan);

    const list = document.createElement("ol"); list.className = "bd-list";
    b.stories.forEach((s, i) => {
      const li = document.createElement("li"); li.className = "bd-us";
      const ul = arr => "<ul>" + arr.map(x => "<li>" + escHtml(x) + "</li>").join("") + "</ul>";
      li.innerHTML =
        '<div class="bd-us-top"><span class="bd-num">US ' + (i + 1) + '</span><span class="bd-us-t">' + escHtml(s.title) + "</span>" +
        '<span class="bd-tags"><span class="bd-tag sp">' + s.sp + ' SP</span><span class="bd-tag pr p' + s.priority + '">עדיפות ' + s.priority + '</span><span class="bd-tag pt">' + escHtml(s.pattern || "") + "</span></span></div>" +
        '<div class="bd-sent">' + escHtml(BreakdownEngine.sentence(s)) + "</div>" +
        "<details><summary>תנאי קבלה, בדיקות ו-Tasks</summary>" +
        '<div class="bd-sec"><h4>Acceptance Criteria</h4>' + ul(s.acceptance) + "</div>" +
        '<div class="bd-tests"><div class="bd-sec pos"><h4>בדיקות חיוביות</h4>' + ul(s.positive) + '</div><div class="bd-sec neg"><h4>בדיקות שליליות</h4>' + ul(s.negative) + "</div></div>" +
        '<div class="bd-sec"><h4>Tasks</h4>' + ul(s.tasks.map(t => t.title)) + "</div></details>";
      list.appendChild(li);
    });
    card.appendChild(list);

    if (b.uiPrompt) {
      const d = document.createElement("details"); d.className = "bd-uip";
      d.innerHTML = "<summary>פרומפט UI/UX (מסכים, שדות וכפתורים)</summary>";
      const pre = document.createElement("pre"); pre.textContent = b.uiPrompt;
      const cp = this.btn("העתקת הפרומפט", "ghost sm", () => this.copy(b.uiPrompt, "הפרומפט הועתק"));
      d.append(pre, cp); card.appendChild(d);
    }

    const acts = document.createElement("div"); acts.className = "bd-acts";
    acts.append(
      this.btn("העתקה", "ghost sm", () => this.copy(BreakdownEngine.text(b), "הפירוק הועתק")),
      this.btn("CSV", "ghost sm", () => this.downloadCsv(b)),
      this.btn("Excel", "ghost sm", e => this.downloadExcel(b, e.currentTarget)),
      this.btn("שיפור עם AI", "sm bd-ai", () => this.toggleAi(card, b, input)));
    const ag = this.agentCfg();
    if (ag) acts.append(this.btn(ag.label || "פירוק עם הסוכן", "sm bd-ai", e => this.runAgent(b, input, e.currentTarget)));
    if (typeof BreakdownCreate !== "undefined") acts.append(this.btn("יצירה ב-Azure", "sm bd-create", () => BreakdownCreate.open(b, input)));
    acts.append(this.btn("פירוק מחדש", "ghost sm", () => this.open(Object.assign({keep: true}, input))));
    card.appendChild(acts);

    const note = document.createElement("div"); note.className = "bd-note";
    note.textContent = "זו הצעה לבדיקה. שום דבר לא נשמר ב-Azure עד שתלחצו \"יצירה ב-Azure\", תשלימו פרטים ותאשרו.";
    card.appendChild(note);
    el.appendChild(card);
    scrollDown();
    return el;
  },

  btn(text, cls, fn) {
    const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = text; b.onclick = fn; return b;
  },

  /* ---------- "שיפור עם AI": copy the prompt to any approved AI chat, paste the answer back ---------- */
  toggleAi(card, b, input) {
    let box = card.querySelector(".bd-aibox");
    if (box) { box.remove(); return; }
    const prompt = BreakdownEngine.prompt(input, b);
    box = document.createElement("div"); box.className = "bd-aibox";
    box.innerHTML = "<h4>שיפור עם AI</h4>" +
      '<ol class="bd-steps"><li>העתיקו את ההנחיה ופתחו צ\'אט AI שמאושר בארגון.</li><li>הדביקו שם את ההנחיה ושלחו.</li><li>העתיקו את כל התשובה והדביקו אותה כאן.</li></ol>' +
      '<p class="bd-small">ההנחיה כוללת רק את תיאור הפיצ\'ר והטיוטה. אין בה טוקן או נתונים מ-Azure.</p>';
    const row = document.createElement("div"); row.className = "bd-airow";
    row.append(this.btn("1. העתקת ההנחיה", "sm", () => this.copy(prompt, "ההנחיה הועתקה. הדביקו אותה בצ'אט ה-AI")));
    const show = document.createElement("details"); show.className = "bd-pshow";
    show.innerHTML = "<summary>הצגת ההנחיה</summary>";
    const pv = document.createElement("textarea"); pv.readOnly = true; pv.rows = 6; pv.value = prompt; pv.className = "bd-in ltrsafe"; pv.setAttribute("aria-label", "ההנחיה ל-AI");
    show.appendChild(pv);
    const ans = document.createElement("textarea"); ans.rows = 5; ans.className = "bd-in"; ans.placeholder = "2. הדביקו כאן את התשובה מה-AI";
    ans.setAttribute("aria-label", "התשובה מה-AI");
    const err = document.createElement("div"); err.className = "bd-err hidden"; err.setAttribute("role", "alert");
    const go = this.btn("3. עדכון הפירוק", "sm", () => {
      try {
        const nb = BreakdownEngine.parse(ans.value, input);
        addMsg("user", escHtml("שיפור הפירוק עם AI"));
        box.remove();
        this.render(nb, input);
        toast("הפירוק עודכן לפי תשובת ה-AI");
      } catch (e) { err.textContent = e.message || String(e); err.classList.remove("hidden"); ans.focus(); }
    });
    box.append(row, show, ans, err, go);
    card.querySelector(".bd-acts").after(box);
    box.scrollIntoView({block: "nearest"});
  },

  async runAgent(b, input, btn) {
    const cfg = this.agentCfg(); if (!cfg) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = "הסוכן עובד...";
    try {
      const nb = await BreakdownEngine.agent(cfg, input, b);
      addMsg("user", escHtml(label));
      this.render(nb, input);
    } catch (e) {
      addMsg("bot error", "הסוכן לא החזיר פירוק: " + escHtml(e.message || String(e)) + ". הפירוק הקודם נשאר כמו שהוא.");
    } finally { btn.disabled = false; btn.textContent = label; }
  },

  /* ---------- export ---------- */
  async copy(text, ok) {
    try { await navigator.clipboard.writeText(text); toast(ok); }
    catch (e) {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      let done = false; try { done = document.execCommand("copy"); } catch (x) { done = false; }
      ta.remove(); toast(done ? ok : "ההעתקה נחסמה בדפדפן. פתחו את \"הצגת ההנחיה\" והעתיקו ידנית");
    }
  },
  fileName(ext) {
    const d = new Date(), p = n => String(n).padStart(2, "0");
    return "feature-breakdown-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "-" + p(d.getHours()) + p(d.getMinutes()) + "." + ext;
  },
  downloadCsv(b) {
    const blob = new Blob([BreakdownEngine.csv(b)], {type: "text/csv;charset=utf-8"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = this.fileName("csv");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  },
  table(b) {
    const cols = ["US Name", "Description", "Acceptance Criteria", "Story Points", "Priority", "Splitting Pattern", "Positive Tests", "Negative Tests", "Tasks"].map(label => ({label, kind: "text"}));
    const rows = b.stories.map(s => ({cells: [s.title, BreakdownEngine.sentence(s), s.acceptance.join("\n"), String(s.sp), String(s.priority), s.pattern, s.positive.join("\n"), s.negative.join("\n"), s.tasks.map(t => t.title).join("\n")], images: []}));
    return {cols, rows, missing: []};
  },
  downloadExcel(b, btn) { return downloadXlsx(this.table(b), btn, this.fileName("xlsx")); },

  init() {
    $("bdBtn").onclick = () => this.open({keep: false});
    $("bdGo").onclick = () => this.submit();
    $("bdCancel").onclick = () => this.close();
    $("bdDlg").addEventListener("click", e => { if (e.target.id === "bdDlg") this.close(); });
    $("bdDlg").addEventListener("keydown", e => {
      if (e.key === "Escape") { e.stopPropagation(); this.close(); }
      else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.submit(); }
    });
  }
};

document.addEventListener("DOMContentLoaded", () => { if (document.getElementById("bdBtn")) BreakdownUI.init(); });
