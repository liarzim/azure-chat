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
      '<ol class="bd-steps"><li>בחרו כלי AI ולחצו "העתקה ופתיחה". ההנחיה מועתקת והכלי נפתח בלשונית חדשה. שם: <b>Ctrl+V</b> ושליחה.</li>' +
      '<li>ה-AI יחזיר קובץ <b>azuri-breakdown.csv</b> במבנה קבוע (אותו מבנה כמו הורדת CSV מאז\'ורי). אם הוא לא יכול ליצור קובץ, הוא יכתוב את התוכן בבלוק קוד.</li>' +
      '<li>העלו כאן את הקובץ (CSV או Excel), או הדביקו את התוכן.</li></ol>' +
      '<p class="bd-small">ההנחיה כוללת רק את תיאור הפיצ\'ר והטיוטה. אין בה טוקן או נתונים מ-Azure.</p>';
    const row = document.createElement("div"); row.className = "bd-airow";
    const tools = this.aiTools();
    if (tools.length) {
      const sel = document.createElement("select"); sel.className = "bd-tool"; sel.setAttribute("aria-label", "כלי AI");
      tools.forEach(t => sel.add(new Option(t.label, t.id)));
      const saved = this.pref("bd_ai_tool"); if (saved && tools.some(t => t.id === saved)) sel.value = saved;
      const go = this.btn("", "sm bd-open", () => this.openTool(tools.find(t => t.id === sel.value), prompt));
      const label = () => { go.textContent = "1. העתקה ופתיחה ב-" + (tools.find(t => t.id === sel.value) || tools[0]).label; };
      sel.onchange = () => { this.pref("bd_ai_tool", sel.value); label(); };
      label();
      row.append(sel, go, this.btn("העתקה בלבד", "ghost sm", () => this.copy(prompt, "ההנחיה הועתקה. הדביקו אותה בצ'אט ה-AI")));
    } else row.append(this.btn("1. העתקת ההנחיה", "sm", () => this.copy(prompt, "ההנחיה הועתקה. הדביקו אותה בצ'אט ה-AI")));
    const show = document.createElement("details"); show.className = "bd-pshow";
    show.innerHTML = "<summary>הצגת ההנחיה</summary>";
    const pv = document.createElement("textarea"); pv.readOnly = true; pv.rows = 6; pv.value = prompt; pv.className = "bd-in"; pv.setAttribute("aria-label", "ההנחיה ל-AI");
    show.appendChild(pv);
    const err = document.createElement("div"); err.className = "bd-err hidden"; err.setAttribute("role", "alert");
    const apply = nb => { addMsg("user", escHtml("שיפור הפירוק עם AI")); box.remove(); this.render(nb, input); toast("הפירוק עודכן לפי תשובת ה-AI"); };
    const fail = e => {
      err.textContent = e.message || String(e); err.classList.remove("hidden");
      const fx = this.btn("העתקת בקשת תיקון ל-AI", "sm", () => this.copy(BreakdownEngine.fixPrompt(), "בקשת התיקון הועתקה. הדביקו אותה באותו צ'אט AI"));
      fx.classList.add("bd-fix"); err.appendChild(document.createElement("br")); err.appendChild(fx);
    };
    const drop = this.fileDrop(input, apply, fail, "2. העלאת הקובץ מה-AI");
    const or = document.createElement("div"); or.className = "bd-or"; or.textContent = "או הדבקה";
    const ans = document.createElement("textarea"); ans.rows = 4; ans.className = "bd-in"; ans.placeholder = "הדביקו כאן את תוכן ה-CSV (או את כל התשובה)";
    ans.setAttribute("aria-label", "התשובה מה-AI");
    const go = this.btn("עדכון הפירוק מהטקסט", "ghost sm", () => {
      try { apply(BreakdownEngine.parse(ans.value, input)); } catch (e) { fail(e); ans.focus(); }
    });
    box.append(row, show, drop, or, ans, go, err);
    card.querySelector(".bd-acts").after(box);
    box.scrollIntoView({block: "nearest"});
  },

  /* A button + drop area that reads a breakdown file: CSV, Excel (.xlsx), JSON or text. */
  fileDrop(input, ok, fail, label) {
    const wrap = document.createElement("div"); wrap.className = "bd-drop";
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = ".csv,.xlsx,.json,.txt,.md,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    inp.className = "bd-file"; inp.setAttribute("aria-label", label);
    const bt = this.btn(label, "sm", () => inp.click());
    const hint = document.createElement("span"); hint.className = "bd-small"; hint.textContent = "או גררו לכאן קובץ CSV / Excel";
    const read = async f => {
      if (!f) return;
      try { ok(await this.readFile(f, input)); }
      catch (e) { fail(e); }
      inp.value = "";
    };
    inp.onchange = () => read(inp.files[0]);
    wrap.addEventListener("dragover", e => { e.preventDefault(); wrap.classList.add("over"); });
    wrap.addEventListener("dragleave", () => wrap.classList.remove("over"));
    wrap.addEventListener("drop", e => { e.preventDefault(); wrap.classList.remove("over"); read(e.dataTransfer.files[0]); });
    wrap.append(bt, hint, inp);
    return wrap;
  },
  async readFile(f, input) {
    if (f.size > 5 * 1024 * 1024) throw new Error("הקובץ גדול מדי (עד 5MB).");
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) return BreakdownEngine.fromRows(await this.xlsxRows(bytes), input);
    if (/\.(xls|docx?|pdf)$/i.test(f.name)) throw new Error("אפשר להעלות CSV או Excel (.xlsx). את הקובץ הזה פתחו ושמרו כ-CSV או כ-xlsx.");
    let text = new TextDecoder("utf-8").decode(bytes);
    if (text.includes("\uFFFD")) { try { text = new TextDecoder("windows-1255").decode(bytes); } catch (e) {} }   // Hebrew CSV saved by older Excel
    return BreakdownEngine.parse(text, input);
  },
  /* Minimal .xlsx reader: the first sheet as rows of text. */
  async xlsxRows(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error("קובץ ה-Excel פגום.");
    const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
    const files = {}, dec = new TextDecoder();
    for (let k = 0; k < count; k++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files[dec.decode(bytes.subarray(p + 46, p + 46 + nlen))] = {method, csize, off};
      p += 46 + nlen + xlen + clen;
    }
    const get = async name => {
      const e = files[name]; if (!e) return null;
      const start = e.off + 30 + dv.getUint16(e.off + 26, true) + dv.getUint16(e.off + 28, true);
      const data = bytes.subarray(start, start + e.csize);
      if (e.method === 0) return dec.decode(data);
      if (e.method !== 8 || typeof DecompressionStream === "undefined") throw new Error("הדפדפן לא יכול לפתוח את קובץ ה-Excel. שמרו אותו כ-CSV ונסו שוב.");
      const out = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
      return dec.decode(out);
    };
    const xml = s => new DOMParser().parseFromString(s, "application/xml");
    const ss = await get("xl/sharedStrings.xml");
    const shared = ss ? [...xml(ss).getElementsByTagName("si")].map(si => [...si.getElementsByTagName("t")].map(t => t.textContent).join("")) : [];
    const sheetName = Object.keys(files).filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/\d+/)) - parseInt(b.match(/\d+/)))[0];
    if (!sheetName) throw new Error("בקובץ ה-Excel אין גיליון.");
    const doc = xml(await get(sheetName));
    const col = r => { let n = 0; for (const ch of r.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
    return [...doc.getElementsByTagName("row")].map(rw => {
      const out = [];
      [...rw.getElementsByTagName("c")].forEach((c, i) => {
        const t = c.getAttribute("t"), r = c.getAttribute("r"), v = c.getElementsByTagName("v")[0];
        let val = "";
        if (t === "s") val = shared[Number(v && v.textContent)] || "";
        else if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map(x => x.textContent).join("");
        else val = v ? v.textContent : "";
        out[r ? col(r) : i] = val;
      });
      return Array.from(out, x => x == null ? "" : x);
    });
  },

  /* AI chats from the team settings; only https links. */
  aiTools() {
    const list = typeof TeamConfig !== "undefined" && TeamConfig.data && Array.isArray(TeamConfig.data.aiTools) ? TeamConfig.data.aiTools : [];
    return list.filter(t => t && t.id && t.label && /^https:\/\/[^\s]+$/i.test(t.url || ""));
  },
  pref(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; }
    return null;
  },
  /* Copy first (needs this page focused), then open the chat in a new tab. A browser does not let one site
     paste into another site's tab, so the person presses Ctrl+V there. */
  async openTool(tool, prompt) {
    if (!tool) return;
    await this.copy(prompt, "ההנחיה הועתקה. בלשונית של " + tool.label + ": Ctrl+V ושליחה");
    window.open(tool.url, "_blank", "noopener");
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

  /* "יש לכם כבר קובץ פירוק?" in the dialog: the text and value are used if filled, not required. */
  importFromDialog(f) {
    const uiEl = document.querySelector('input[name="bdUi"]:checked');
    const input = {text: $("bdText").value.trim(), value: $("bdValue").value.trim(), role: $("bdRole").value.trim(), ui: uiEl ? uiEl.value === "1" : false};
    return this.readFile(f, input).then(b => {
      if (!input.text) input.text = b.feature.title;
      this.close();
      addMsg("user", escHtml("ייבוא פירוק מקובץ: " + f.name));
      this.render(b, input);
    }, e => this.err(e.message || String(e)));
  },

  init() {
    $("bdBtn").onclick = () => this.open({keep: false});
    $("bdImport").onclick = () => $("bdImportFile").click();
    $("bdImportFile").onchange = () => { const f = $("bdImportFile").files[0]; $("bdImportFile").value = ""; if (f) this.importFromDialog(f); };
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
