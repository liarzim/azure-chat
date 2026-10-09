"use strict";
/* ============================================================
   Feature breakdown, stage 2: create it in Azure DevOps.
   One screen: the new Feature (optional parent Epic, required
   fields, Description from the team template), fields shared by
   the User Stories and Tasks, and every US with its sprint, Story
   Points Values and Tasks (Original Estimate filled by the user).
   Nothing is written before an explicit second confirmation.
   Order: Feature -> each US -> its Tasks. A failure skips only the
   children of the failed item; the summary lists what was created.
   ============================================================ */

const BD_TAG = "אז'ורי-פירוק";
const BD_REF = {title: "System.Title", area: "System.AreaPath", iter: "System.IterationPath", desc: "System.Description", tags: "System.Tags",
  spv: "Custom.StoryPointsValues", est: "Microsoft.VSTS.Scheduling.OriginalEstimate", who: "System.AssignedTo"};
/* Fields the screen fills itself (per item or automatically), so they are not asked again as "shared". */
const BD_HANDLED = {
  "Feature": [BD_REF.title, BD_REF.area, BD_REF.iter, BD_REF.desc, BD_REF.tags, BD_REF.spv, BD_REF.who],
  "User Story": [BD_REF.title, BD_REF.area, BD_REF.iter, BD_REF.desc, BD_REF.tags, BD_REF.spv],
  "Task": [BD_REF.title, BD_REF.area, BD_REF.iter, BD_REF.tags, BD_REF.est]
};

/* ---------- Description from a template ---------- */
const BD_SECTIONS = [
  ["desc", /תאור|תיאור|description/i], ["value", /ערך|value/i], ["acceptance", /accept|קבלה|demo/i],
  ["arch", /ארכיטקט/], ["deps", /תלו/], ["tests", /\bqa\b|בדיק|test/i], ["ui", /ux|ui|עיצוב|תרשים/i]
];
const BD_FALLBACK_TPL = {field: "System.Description", headingColor: "#0033CC", headings: [
  {text: "תאור הדרישה", content: ""}, {text: "ערך ללקוח", content: ""}, {text: "Acceptance Criteria", content: ""}, {text: "QA- הגדרת בדיקות", content: ""}]};
function bdSectionOf(heading) { const hit = BD_SECTIONS.find(([, rx]) => rx.test(heading)); return hit ? hit[0] : null; }
function bdLines(arr) { return arr.filter(Boolean).map(t => '<div style="direction:rtl;">' + escHtml(t) + "</div>").join(""); }
function bdList(arr) { return arr && arr.length ? '<ul style="direction:rtl;">' + arr.map(t => "<li>" + escHtml(t) + "</li>").join("") + "</ul>" : ""; }
/* fill: {section: html}. Headings without generated content keep the template's own content. */
function bdFillTemplate(tpl, fill) {
  const color = tpl.headingColor || "#0033CC";
  const html = tpl.headings.map(h => {
    const key = bdSectionOf(h.text), gen = key ? fill[key] : "";
    let body = gen || "";
    if (key === "tests" && gen && h.content) body = h.content + gen;          // keep the team's QA legend, add the tests below it
    if (!body) body = h.content || '<div style="direction:rtl;"><br></div>';
    return '<div style="direction:rtl;"><b><u><span style="color:' + color + '">' + escHtml(h.text) + ":</span></u></b></div>" + body + '<div style="direction:rtl;"><br></div>';
  }).join("");
  return rtlBlocks(html);
}
function bdTemplateFor(type) { return TeamConfig.template(type) || TeamConfig.template("Feature") || BD_FALLBACK_TPL; }
function bdFeatureDescription(b, input) {
  const deps = b.stories.filter(s => s.pattern === BD_PATTERNS.spike || s.pattern === BD_PATTERNS.workflow && /ממשק|נתונים מ/.test(s.title)).map(s => s.title);
  return bdFillTemplate(bdTemplateFor("Feature"), {
    desc: bdLines(String(input.text || b.feature.title).split(/\n+/)),
    value: bdLines([b.feature.value || input.value]),
    acceptance: bdList(b.stories.map(s => s.title)),
    ui: b.feature.ui ? bdLines(String(b.uiPrompt || "").split("\n")) : bdLines(["לא נדרש"]),
    deps: deps.length ? bdList(deps) : "",
    tests: bdLines(["בדיקות מפורטות (3 חיוביות ו-3 שליליות) בכל User Story."])
  });
}
function bdStoryDescription(s, b) {
  return bdFillTemplate(bdTemplateFor("User Story"), {
    desc: bdLines([BreakdownEngine.sentence(s), "תבנית פירוק: " + (s.pattern || "")]),
    value: bdLines([s.soThat || b.feature.value]),
    acceptance: bdList(s.acceptance),
    tests: '<div style="direction:rtl;"><b>בדיקות חיוביות:</b></div>' + bdList(s.positive) + '<div style="direction:rtl;"><b>בדיקות שליליות:</b></div>' + bdList(s.negative)
  });
}
/* "02 = 1-2d" style lists: the smallest value whose leading number is at least sp. */
function bdSpValue(sp, allowed) {
  const nums = (allowed || []).map(v => ({v, n: parseFloat(String(v).match(/\d+(?:\.\d+)?/) || [NaN])})).filter(x => !isNaN(x.n)).sort((a, c) => a.n - c.n);
  if (!nums.length) return null;
  const hit = nums.find(x => x.n >= sp);
  return (hit || nums[nums.length - 1]).v;
}
/* ---------- Iterations: PI = the node right above the sprints (the dated leaves) ---------- */
function bdFind(tree, p) { if (!tree || !p) return null; const f = n => n.path === p ? n : (n.children || []).reduce((r, c) => r || f(c), null); return f(tree); }
function bdParent(tree, p) { if (!tree) return null; const f = n => (n.children || []).reduce((r, c) => r || (c.path === p ? n : f(c)), null); return f(tree); }
function bdIsLeaf(n) { return !n.children || !n.children.length; }
/* The PI of a sprint (its parent), or the node itself when it is a PI (all its children are sprints). */
function bdPiOf(tree, p) {
  const n = bdFind(tree, p); if (!n) return null;
  if (bdIsLeaf(n)) { const par = bdParent(tree, p); return par && par !== tree ? par : null; }
  return n !== tree && n.children.every(bdIsLeaf) ? n : null;
}
/* Sprints with dates from the current one on, across the PIs next to the given iteration. */
function bdSprints(tree, near, today) {
  if (!tree) return [];
  const pi = bdPiOf(tree, near);
  const anchor = pi ? (bdParent(tree, pi.path) || tree) : (bdFind(tree, near) || tree);
  const leaves = [];
  const walk = n => { if (!bdIsLeaf(n)) n.children.forEach(walk); else if (n.start && n.finish) leaves.push(n); };
  walk(anchor);
  const t = today ? new Date(today) : new Date(); t.setHours(0, 0, 0, 0);
  return leaves.filter(l => new Date(l.finish).getTime() + 86400000 > t.getTime()).sort((a, c) => new Date(a.start) - new Date(c.start));
}
function bdDate(d) { const x = new Date(d); return x.getUTCDate() + "." + (x.getUTCMonth() + 1); }

const BreakdownCreate = {
  today: null,           // tests can pin "today"
  s: null,

  async open(b, input) {
    if (this.s && this.s.running) return;
    $("bcPanel").classList.remove("hidden");
    $("bcBody").innerHTML = '<div class="muted pad loading">טוען את השדות מ-Azure DevOps...</div>';
    $("bcFoot").classList.add("hidden");
    let metas, paths;
    try {
      metas = {"Feature": await Meta.typeMeta("Feature"), "User Story": await Meta.typeMeta("User Story"), "Task": await Meta.typeMeta("Task")};
      try { paths = await Meta.classPaths(); } catch (e) { paths = null; }
    } catch (e) {
      $("bcBody").innerHTML = '<div class="err">לא ניתן לטעון את השדות: ' + escHtml(e.message || String(e)) + '<br><button type="button" class="btn ghost" id="bcRetry">נסו שוב</button></div>';
      $("bcRetry").onclick = () => this.open(b, input);
      return;
    }
    const last = lastPaths();
    this.s = {b, input, metas, tree: paths && paths.trees ? paths.trees.iteration : null, hasEpic: null, epic: null, epicReq: 0,
      fEd: new Map(), usEd: new Map(), taskEd: new Map(), touched: new Set(), stories: [], firstSprint: 0, sprints: [], running: false, fcards: {}, groups: [],
      defaults: {area: last.area || TeamConfig.data.project, iter: last.iteration || TeamConfig.data.project}};
    this.render();
  },
  close() {
    if (this.s && this.s.running) return;
    $("bcPanel").classList.add("hidden"); this.s = null; $("input").focus();
  },

  /* ---------- building the screen ---------- */
  render() {
    const s = this.s, b = s.b, body = $("bcBody");
    body.innerHTML = "";
    const intro = document.createElement("p"); intro.className = "bc-intro";
    intro.innerHTML = "ייווצרו Feature (ברמת PI), " + b.stories.length + " User Stories וה-Tasks שלהם. אם ה-User Stories חורגים מ-PI אחד או מ-" + this.maxSprints() + " ספרינטים, הפירוק מתחלק לכמה Features. כל הפריטים יקבלו את התגית <b>" + escHtml(BD_TAG) + "</b>. שום דבר לא נשמר לפני האישור.";
    body.appendChild(intro);

    // 1. Feature
    const fs = this.section(body, "1. Epic ושדות לכל ה-Features");
    const ask = document.createElement("div"); ask.className = "bc-ask";
    ask.innerHTML = '<span class="bc-q">האם יש Epic אב?</span>';
    [["כן", true], ["לא", false]].forEach(([t, v]) => {
      const lab = document.createElement("label"); const r = document.createElement("input"); r.type = "radio"; r.name = "bcEpicQ"; r.value = v ? "1" : "0";
      r.onchange = () => { s.hasEpic = v; epicRow.classList.toggle("hidden", !v); if (v) epicIn.focus(); this.refresh(); };
      lab.append(r, " " + t); ask.appendChild(lab);
    });
    const epicRow = document.createElement("div"); epicRow.className = "bc-epic picker hidden";
    const epicIn = document.createElement("input"); epicIn.id = "bcEpic"; epicIn.placeholder = "מספר ה-Epic, או מילים מהכותרת"; epicIn.setAttribute("aria-label", "Epic אב"); epicIn.autocomplete = "off";
    const epicList = document.createElement("div"); epicList.className = "bc-epic-list";
    const epicInfo = document.createElement("div"); epicInfo.id = "bcEpicInfo";
    epicIn.oninput = () => { clearTimeout(this._epicT); this._epicT = setTimeout(() => this.lookupEpic(epicIn.value, epicList, epicInfo), 350); };
    epicRow.append(epicIn, epicList, epicInfo);
    fs.append(ask, epicRow);
    const fGrid = document.createElement("div"); fGrid.className = "bc-grid"; fs.appendChild(fGrid); s.fGrid = fGrid;
    [[BD_REF.area, s.defaults.area], [BD_REF.who, undefined]].forEach(([ref, v]) => this.addEditor("Feature", ref, v, fGrid, s.fEd));
    this.requiredOf("Feature").forEach(ref => this.addEditor("Feature", ref, undefined, fGrid, s.fEd, "חובה"));

    // 2. The features (one per PI, up to N sprints each), rebuilt when the sprints change
    const fsec = this.section(body, "2. ה-Features");
    const fNote = document.createElement("p"); fNote.className = "muted";
    fNote.textContent = "Feature תמיד ברמת PI. כל Feature מכסה עד " + this.maxSprints() + " ספרינטים בתוך PI אחד. השם וה-Story Points Values ניתנים לשינוי.";
    s.featBox = document.createElement("div"); s.featBox.className = "bc-feats";
    fsec.append(fNote, s.featBox);

    // 2. Shared fields
    const ss = this.section(body, "3. שדות לכל ה-User Stories");
    const sNote = document.createElement("p"); sNote.className = "muted";
    sNote.textContent = "ממולאים מה-Feature. שינוי כאן חל על כל ה-User Stories. Area לקוח מה-Feature.";
    ss.appendChild(sNote);
    const usGrid = document.createElement("div"); usGrid.className = "bc-grid"; ss.appendChild(usGrid); s.usGrid = usGrid;
    this.requiredOf("User Story").forEach(ref => this.addEditor("User Story", ref, this.featureVal(ref), usGrid, s.usEd, "חובה"));
    const spr = document.createElement("div"); spr.className = "eprow bc-sprint";
    spr.innerHTML = '<div class="ephead"><label for="bcFirst">ספרינט 1 בתכנון =</label></div>';
    const sel = document.createElement("select"); sel.id = "bcFirst"; spr.appendChild(sel); s.firstSel = sel;
    sel.onchange = () => { s.firstSprint = Number(sel.value) || 0; this.assignSprints(); this.refresh(); };
    const sprNote = document.createElement("div"); sprNote.className = "bc-hint"; spr.appendChild(sprNote); s.sprNote = sprNote;
    ss.appendChild(spr);
    const tGrid = document.createElement("div"); tGrid.className = "bc-grid"; s.tGrid = tGrid;
    const taskReq = this.requiredOf("Task");
    if (taskReq.length) {
      const h = document.createElement("h4"); h.textContent = "שדות לכל ה-Tasks"; ss.append(h, tGrid);
      taskReq.forEach(ref => this.addEditor("Task", ref, this.featureVal(ref), tGrid, s.taskEd, "חובה"));
    } else ss.appendChild(tGrid);

    // 4. Stories and tasks: everything editable before anything is sent
    const st = this.section(body, "4. User Stories ו-Tasks");
    const stNote = document.createElement("p"); stNote.className = "muted";
    stNote.textContent = "אפשר לערוך כל US לפני היצירה: כותרת, ניסוח, תנאי קבלה, בדיקות ו-Tasks. אפשר גם להוסיף US ו-Tasks או להוריד אותם.";
    st.appendChild(stNote);
    s.usList = document.createElement("div"); st.appendChild(s.usList);
    const sprintOf = new Map(); b.sprints.forEach((ix, k) => ix.forEach(i => sprintOf.set(i, k)));
    b.stories.forEach((story, i) => this.addStory(JSON.parse(JSON.stringify(story)), sprintOf.has(i) ? sprintOf.get(i) : 0));
    const addUs = this.btnEl("+ User Story", "ghost sm bc-add-us", () => {
      const last = s.stories.length ? Math.max(...s.stories.map(r => r.sprint)) : 0;
      const role = s.b.role || "משתמש";
      const rec = this.addStory({title: "", asA: role, iWant: "", soThat: s.b.feature.value || "", pattern: BD_PATTERNS.ops, sp: 2, priority: 4,
        acceptance: [], positive: [], negative: [], tasks: [{title: "פיתוח: "}, {title: "בדיקות QA: "}]}, last);
      this.assignSprints(); rec.details.open = true; rec.title.focus(); this.refresh();
    });
    st.appendChild(addUs);
    this.updateSprints();
    $("bcFoot").classList.remove("hidden");
    $("bcConfirm").classList.add("hidden");
    $("bcGo").classList.remove("hidden");
    this.refresh();
  },

  btnEl(text, cls, fn) { const b = document.createElement("button"); b.type = "button"; b.className = "btn " + cls; b.textContent = text; b.onclick = fn; return b; },
  /* A text area holding one item per line (criteria, tests). */
  linesEl(label, arr, onChange) {
    const w = document.createElement("label"); w.className = "bc-lab bc-lines";
    const l = document.createElement("span"); l.textContent = label;
    const ta = document.createElement("textarea"); ta.className = "bc-ta"; ta.rows = Math.max(3, (arr || []).length + 1); ta.value = (arr || []).join("\n");
    ta.setAttribute("aria-label", label);
    ta.oninput = () => onChange(ta.value.split("\n").map(x => x.trim()).filter(Boolean));
    w.append(l, ta); return w;
  },
  inputEl(label, value, onChange, cls) {
    const w = document.createElement("label"); w.className = "bc-lab " + (cls || "");
    const l = document.createElement("span"); l.textContent = label;
    const inp = document.createElement("input"); inp.className = "bc-title"; inp.value = value || ""; inp.setAttribute("aria-label", label);
    inp.oninput = () => onChange(inp.value.trim());
    w.append(l, inp); return w;
  },
  /* One US card. story is the screen's own copy, edited in place. */
  addStory(story, sprint) {
    const s = this.s, b = s.b, um = s.metas["User Story"];
    const i = s.stories.length ? Math.max(...s.stories.map(r => r.i)) + 1 : 0;
    const card = document.createElement("div"); card.className = "bc-us";
    const top = document.createElement("div"); top.className = "bc-us-top";
    const inc = document.createElement("input"); inc.type = "checkbox"; inc.checked = true; inc.setAttribute("aria-label", "ליצור את US " + (i + 1));
    const num = document.createElement("span"); num.className = "bd-num"; num.textContent = "US " + (i + 1);
    const title = document.createElement("input"); title.className = "bc-title"; title.value = story.title; title.setAttribute("aria-label", "כותרת US " + (i + 1));
    title.placeholder = "כותרת ה-US";
    top.append(inc, num, title);
    const row = document.createElement("div"); row.className = "bc-us-fields";
    const rec = {story, i, sprint, card, inc, title, tasks: [], spv: null, iter: null, iterTouched: false};
    if (um.byRef.has(BD_REF.spv)) {
      const f = um.byRef.get(BD_REF.spv);
      rec.spv = makeEditor(f, bdSpValue(story.sp, f.allowed), {type: "User Story", meta: um, onChange: () => this.refresh()});
      const ssel = rec.spv.el.querySelector("select"); if (ssel) ssel.dir = "ltr";
      row.appendChild(this.labeled("Story Points Values", rec.spv.el, "בפירוק: \u2066" + story.sp + " SP\u2069"));
    }
    const fi = um.byRef.get(BD_REF.iter);
    if (fi) {
      rec.iter = makeEditor(fi, s.defaults.iter, {type: "User Story", meta: um, onChange: () => { rec.iterTouched = true; rec.noSprint = false; this.refresh(); }});
      const lab = this.labeled("Iteration", rec.iter.el, "ספרינט " + (sprint + 1) + " בתכנון");
      rec.warn = document.createElement("span"); rec.warn.className = "bc-warn hidden"; rec.warn.textContent = "אין ספרינט: ה-PI הבא עוד לא קיים ב-Azure. בחרו Iteration או הורידו את הסימון.";
      lab.appendChild(rec.warn);
      row.appendChild(lab);
    }
    // the US content: sentence, pattern, criteria, tests, with a live Description preview
    const dd = document.createElement("details"); dd.className = "bc-desc bc-edit";
    dd.innerHTML = "<summary>עריכת ה-US: ניסוח, תנאי קבלה ובדיקות</summary>";
    const ed = document.createElement("div"); ed.className = "bc-edit-grid";
    const changed = () => { this.refresh(); };
    ed.append(
      this.inputEl("כ... (סוג משתמש)", story.asA, v => { story.asA = v; changed(); }, "bc-as"),
      this.inputEl("אני רוצה...", story.iWant, v => { story.iWant = v; changed(); }, "bc-want"),
      this.inputEl("כך ש...", story.soThat, v => { story.soThat = v; changed(); }, "bc-so"));
    const pw = document.createElement("label"); pw.className = "bc-lab";
    const pl = document.createElement("span"); pl.textContent = "תבנית פירוק";
    const psel = document.createElement("select"); psel.className = "bc-sel"; psel.setAttribute("aria-label", "תבנית פירוק");
    const pats = Object.values(BD_PATTERNS);
    if (story.pattern && !pats.includes(story.pattern)) pats.push(story.pattern);
    pats.forEach(x => psel.add(new Option(x, x))); psel.value = story.pattern || BD_PATTERNS.ops;
    story.pattern = psel.value;
    psel.onchange = () => { story.pattern = psel.value; changed(); };
    pw.append(pl, psel); ed.appendChild(pw);
    ed.append(
      this.linesEl("תנאי קבלה (שורה לכל תנאי)", story.acceptance, v => { story.acceptance = v; changed(); }),
      this.linesEl("בדיקות חיוביות (שורה לכל בדיקה)", story.positive, v => { story.positive = v; changed(); }),
      this.linesEl("בדיקות שליליות (שורה לכל בדיקה)", story.negative, v => { story.negative = v; changed(); }));
    const pvd = document.createElement("details"); pvd.className = "bc-desc";
    pvd.innerHTML = "<summary>תצוגה מקדימה של ה-Description</summary>";
    rec.preview = document.createElement("div"); rec.preview.className = "bc-preview"; pvd.appendChild(rec.preview);
    dd.append(ed, pvd);
    rec.details = dd;
    const tl = document.createElement("div"); tl.className = "bc-tasks";
    const th = document.createElement("div"); th.className = "bc-th"; th.innerHTML = "<span>Tasks</span><span>Original Estimate (שעות)</span>";
    const addTask = t => {
      const tr = document.createElement("div"); tr.className = "bc-task";
      const tinc = document.createElement("input"); tinc.type = "checkbox"; tinc.checked = true; tinc.setAttribute("aria-label", "ליצור את ה-Task");
      const tt = document.createElement("input"); tt.className = "bc-title"; tt.value = t.title || ""; tt.placeholder = "כותרת ה-Task";
      tt.setAttribute("aria-label", "כותרת Task של US " + (i + 1));
      const est = document.createElement("input"); est.type = "number"; est.min = "0"; est.step = "0.5"; est.className = "bc-est"; est.placeholder = "שעות";
      est.setAttribute("aria-label", "Original Estimate (שעות) של " + (t.title || "Task"));
      if (t.hours != null && t.hours !== "") est.value = t.hours;
      const tr_ = {inc: tinc, title: tt, est, row: tr};
      const del = this.btnEl("✕", "ghost sm bc-del", () => { tr.remove(); rec.tasks.splice(rec.tasks.indexOf(tr_), 1); this.refresh(); });
      del.title = "מחיקת ה-Task"; del.setAttribute("aria-label", "מחיקת ה-Task");
      [tinc, tt, est].forEach(x => x.addEventListener(x.type === "checkbox" ? "change" : "input", () => this.refresh()));
      tr.append(tinc, tt, est, del); tl.appendChild(tr);
      rec.tasks.push(tr_);
      return tr_;
    };
    (story.tasks || []).forEach(addTask);
    const plusTask = this.btnEl("+ Task", "ghost sm bc-add-task", () => { const t = addTask({title: ""}); t.title.focus(); this.refresh(); });
    const delUs = this.btnEl("מחיקת ה-US", "ghost sm bc-del-us", () => { card.remove(); s.stories.splice(s.stories.indexOf(rec), 1); this.refresh(); });
    const acts = document.createElement("div"); acts.className = "bc-us-acts"; acts.append(plusTask, delUs);
    card.append(top, row, dd, th, tl, acts);
    inc.onchange = () => { card.classList.toggle("off", !inc.checked); this.refresh(); };
    title.oninput = () => this.refresh();
    s.usList.appendChild(card);
    s.stories.push(rec);
    return rec;
  },

  section(body, title) {
    const sec = document.createElement("section"); sec.className = "bc-sec";
    const h = document.createElement("h3"); h.textContent = title; sec.appendChild(h); body.appendChild(sec); return sec;
  },
  labeled(text, el, hint) {
    const w = document.createElement("div"); w.className = "bc-lab";
    const l = document.createElement("span"); l.textContent = text; w.appendChild(l); w.appendChild(el);
    if (hint) { const h = document.createElement("span"); h.className = "bc-hint"; h.textContent = hint; w.appendChild(h); }
    return w;
  },
  /* The team's required fields for this type, minus what the screen fills itself. Azure's own required
     fields (and conditional rules) are added by check() only when they are still empty after defaults. */
  requiredOf(type) {
    const m = this.s.metas[type], out = [];
    TeamConfig.requiredFor(type).forEach(ref => { if (m.byRef.has(ref) && !BD_HANDLED[type].includes(ref) && !out.includes(ref)) out.push(ref); });
    return out;
  },
  addEditor(type, ref, value, grid, map, reason) {
    const s = this.s, m = s.metas[type];
    if (map.has(ref) || !m.byRef.has(ref)) return;
    const f = m.byRef.get(ref);
    const row = document.createElement("div"); row.className = "eprow" + (f.type === "html" ? " wide" : "");
    const lab = document.createElement("label"); lab.textContent = f.label;
    if (reason) { const r = document.createElement("span"); r.className = "need"; r.textContent = reason; lab.appendChild(r); }
    const key = type + "|" + ref;
    if (value === undefined) value = defaultFieldValue(f);
    const ed = makeEditor(f, value, {type, meta: m, onChange: () => { s.touched.add(key); if (type === "Feature") this.featureChanged(ref); this.refresh(); }});
    const head = document.createElement("div"); head.className = "ephead"; head.appendChild(lab);
    row.append(head, ed.el); grid.appendChild(row);
    map.set(ref, {ed, row});
  },
  featureVal(ref) { const e = this.s.fEd.get(ref); return e ? e.ed.get() : undefined; },
  /* Shared fields follow the Feature until the user changes them. */
  featureChanged(ref) {
    const s = this.s, v = this.featureVal(ref);
    [["User Story", s.usEd], ["Task", s.taskEd]].forEach(([type, map]) => { const e = map.get(ref); if (e && !s.touched.has(type + "|" + ref)) e.ed.set(v); });
  },
  maxSprints() { const n = Number(TeamConfig.data && TeamConfig.data.featureMaxSprints); return n >= 1 ? Math.floor(n) : 3; },

  /* ---------- parent Epic ---------- */
  async lookupEpic(raw, list, info) {
    const s = this.s, req = ++s.epicReq, q = String(raw || "").trim();
    s.epic = null; list.innerHTML = ""; info.className = ""; info.innerHTML = "";
    if (!q) { this.refresh(); return; }
    try {
      if (/^\d+$/.test(q)) {
        info.textContent = "בודק..."; info.className = "muted";
        const it = (await fetchItems([Number(q)]))[0];
        if (req !== s.epicReq) return;
        if (!it || !it.fields) { info.className = "bad"; info.textContent = "פריט " + q + " לא נמצא"; }
        else this.pickEpic(it, list, info);
      } else if (q.length >= 2) {
        const found = await searchItems(q, ["Epic"], 10);
        if (req !== s.epicReq) return;
        if (!found.length) { info.className = "muted"; info.textContent = "לא נמצאו Epics פתוחים עבור \"" + q + "\""; }
        found.forEach(it => {
          const bt = document.createElement("button"); bt.type = "button"; bt.className = "bc-pick";
          bt.innerHTML = '<span class="srch-id" dir="ltr">' + it.id + "</span> " + escHtml(it.fields["System.Title"] || "");
          bt.onclick = () => { $("bcEpic").value = String(it.id); list.innerHTML = ""; this.pickEpic(it, list, info); };
          list.appendChild(bt);
        });
      }
    } catch (e) { if (req === s.epicReq) { info.className = "bad"; info.textContent = e.message || String(e); } }
    this.refresh();
  },
  pickEpic(it, list, info) {
    const s = this.s, f = it.fields, type = f["System.WorkItemType"];
    s.epic = it;
    info.className = "parentcard" + (type === "Epic" ? "" : " warn");
    info.innerHTML = '<span class="pc-type">' + escHtml(type) + "</span> <b dir=\"ltr\">" + it.id + '</b> <span class="pc-title">' + escHtml(f["System.Title"] || "") + "</span>" +
      (type === "Epic" ? "" : '<div class="pc-warn">זה לא Epic. בדרך כלל Feature נפתח תחת Epic.</div>');
    // the Epic's paths, unless the user already chose
    [[BD_REF.area, f["System.AreaPath"]]].forEach(([ref, v]) => {
      const e = s.fEd.get(ref); if (e && v && !s.touched.has("Feature|" + ref)) { e.ed.set(v); this.featureChanged(ref); }
    });
    this.refresh();
  },

  /* ---------- sprints ---------- */
  updateSprints() {
    const s = this.s, today = this.today ? new Date(this.today) : new Date();
    s.sprints = bdSprints(s.tree, s.defaults.iter, today);
    const sel = s.firstSel; sel.innerHTML = "";
    s.sprints.forEach((n, k) => sel.add(new Option(n.path.split("\\").slice(-2).join(" \\ ") + " (" + bdDate(n.start) + "–" + bdDate(n.finish) + ")" + (new Date(n.start) <= today ? " · נוכחי" : ""), String(k))));
    if (!s.sprints.length) sel.add(new Option("לא נמצאו ספרינטים עם תאריכים", "0"));
    s.firstSprint = Math.min(s.firstSprint, Math.max(0, s.sprints.length - 1)); sel.value = String(s.firstSprint);
    sel.disabled = !s.sprints.length;
    s.sprNote.textContent = s.sprints.length ? "כל US מקבל ספרינט לפי התכנון (ספרינט 1, 2...). אפשר לשנות לכל US בנפרד." : "לא נמצאו ספרינטים עם תאריכים. בחרו Iteration לכל US.";
    this.assignSprints();
  },
  assignSprints() {
    const s = this.s;
    s.stories.forEach(r => {
      if (!r.iter || r.iterTouched) return;
      const k = s.firstSprint + r.sprint;
      r.noSprint = s.sprints.length > 0 && k >= s.sprints.length;      // the next PI is not in Azure yet
      r.iter.set(r.noSprint ? null : (s.sprints[k] ? s.sprints[k].path : s.defaults.iter));
    });
  },

  /* ---------- features: one per PI, at most maxSprints sprints each ---------- */
  groups() {
    const s = this.s, max = this.maxSprints(), byPi = new Map();
    s.stories.forEach(r => {
      if (!r.inc.checked || r.noSprint) return;
      const path = r.iter ? r.iter.get() : s.defaults.iter;
      const pi = bdPiOf(s.tree, path);
      const key = pi ? pi.path : (path || TeamConfig.data.project);
      if (!byPi.has(key)) byPi.set(key, {pi, piPath: key, recs: []});
      byPi.get(key).recs.push(r);
    });
    const out = [];
    byPi.forEach(g => {
      const node = r => bdFind(s.tree, r.iter ? r.iter.get() : "");
      const start = r => { const n = node(r); return n && n.start ? new Date(n.start).getTime() : 0; };
      const sprints = [...new Set(g.recs.map(r => r.iter ? r.iter.get() : ""))].sort((a, b) => {
        const na = bdFind(s.tree, a), nb = bdFind(s.tree, b);
        return (na && na.start ? new Date(na.start) : 0) - (nb && nb.start ? new Date(nb.start) : 0);
      });
      const chunks = Math.max(1, Math.ceil(sprints.length / max));
      for (let c = 0; c < chunks; c++) {
        const mine = sprints.slice(c * max, (c + 1) * max);
        const recs = g.recs.filter(r => mine.includes(r.iter ? r.iter.get() : ""));
        if (!recs.length) continue;
        out.push({key: g.piPath + "#" + c, piPath: g.piPath, sprints: mine, recs, first: Math.min(...recs.map(start))});
      }
    });
    return out.sort((a, b) => a.first - b.first || a.key.localeCompare(b.key));
  },
  /* One feature keeps the breakdown's name. Split features are named by what their US do:
     "<topic> – <US>, <US> ועוד N", real work first, Spikes last. */
  autoTitle(g, k, n) {
    const s = this.s, b = s.b;
    if (n === 1) return b.feature.title;
    const topic = BreakdownEngine.subject(s.input.text || b.feature.title, b.feature.title);
    const recs = g.recs.slice().sort((x, y) => (x.story.pattern === BD_PATTERNS.spike) - (y.story.pattern === BD_PATTERNS.spike));
    const names = recs.map(r => r.title.value.trim()).filter(Boolean);
    const list = names.slice(0, 2).join(", ") + (names.length > 2 ? " ועוד " + (names.length - 2) : "");
    return ((topic && topic !== "הפיצ'ר" ? topic + " – " : "") + list).slice(0, 200);
  },
  /* Rebuilds the feature cards; titles and values the user changed are kept per PI part. */
  renderFeatures(groups) {
    const s = this.s, box = s.featBox, fm = s.metas["Feature"], n = groups.length;
    const sig = groups.map(g => g.key + ":" + g.recs.map(r => r.i).join(",")).join("|");
    if (sig === s.featSig) { groups.forEach(g => { const c = s.fcards[g.key]; if (c && !c.titleTouched) c.title.value = this.autoTitle(g, 0, n); }); return; }
    s.featSig = sig; box.innerHTML = "";
    if (!n) { box.innerHTML = '<div class="muted">אין User Stories עם ספרינט.</div>'; return; }
    groups.forEach((g, k) => {
      const prev = s.fcards[g.key] || {};
      const card = document.createElement("div"); card.className = "bc-feat";
      const top = document.createElement("div"); top.className = "bc-us-top";
      const num = document.createElement("span"); num.className = "bd-num"; num.textContent = "Feature " + (k + 1);
      const title = document.createElement("input"); title.className = "bc-title"; title.setAttribute("aria-label", "כותרת Feature " + (k + 1));
      title.value = prev.titleTouched ? prev.title.value : this.autoTitle(g, k, n);
      const c = {title, titleTouched: !!prev.titleTouched, spv: null, spvTouched: !!prev.spvTouched};
      title.oninput = () => { c.titleTouched = true; this.refresh(); };
      top.append(num, title);
      const row = document.createElement("div"); row.className = "bc-us-fields";
      const sprintNames = g.sprints.map(p => p.split("\\").pop());
      const pi = document.createElement("div"); pi.className = "bc-lab";
      pi.innerHTML = "<span>Iteration (PI)</span><b class=\"bc-pi\">" + escHtml(g.piPath.split("\\").pop()) + '</b><span class="bc-hint">' + escHtml(g.piPath) + "</span>";
      row.appendChild(pi);
      const f = fm.byRef.get(BD_REF.spv);
      if (f) {
        const maxSp = Math.max(...g.recs.map(r => r.story.sp));
        const auto = bdSpValue(n === 1 ? s.b.feature.sp : maxSp, f.allowed);
        c.spv = makeEditor(f, prev.spvTouched && prev.spv ? prev.spv.get() : auto, {type: "Feature", meta: fm, onChange: () => { c.spvTouched = true; this.refresh(); }});
        const sel = c.spv.el.querySelector("select"); if (sel) sel.dir = "ltr";
        row.appendChild(this.labeled("Story Points Values", c.spv.el, n === 1 ? "לפי הפירוק: \u2066" + s.b.feature.sp + " SP\u2069 לפיצ'ר. סך ה-User Stories: \u2066" + s.b.totalSp + " SP\u2069." : "לפי ה-US הגבוה: \u2066" + maxSp + " SP\u2069"));
      }
      const what = document.createElement("div"); what.className = "bc-hint bc-what";
      what.textContent = "US " + g.recs.map(r => r.i + 1).join(", ") + " · ספרינטים: " + sprintNames.join(", ");
      const dd = document.createElement("details"); dd.className = "bc-desc";
      dd.innerHTML = "<summary>Description של ה-Feature (נבנה מהתבנית ומהפירוק)</summary>";
      c.preview = document.createElement("div"); c.preview.className = "bc-preview"; dd.appendChild(c.preview);
      card.append(top, row, what, dd); box.appendChild(card);
      s.fcards[g.key] = c;
    });
  },
  featureDescription(g, k, n) {
    const s = this.s;
    const stories = g.recs.map(r => Object.assign({}, r.story, {title: r.title.value.trim()}));
    const input = n > 1 ? Object.assign({}, s.input, {text: (s.input.text || s.b.feature.title) + "\n" + "חלק " + (k + 1) + " מתוך " + n + " (" + g.piPath.split("\\").pop() + ")."}) : s.input;
    return bdFeatureDescription(Object.assign({}, s.b, {stories}), input);
  },

  /* ---------- what will be created ---------- */
  newItem(type) {
    const m = this.s.metas[type];
    const fields = {"System.WorkItemType": type, "System.TeamProject": TeamConfig.data.project};
    m.byRef.forEach(f => { const d = defaultFieldValue(f); if (d !== undefined) fields[f.ref] = d; });
    return {id: null, rev: 0, fields, relations: []};
  },
  put(ch, type, ref, v) { if (this.s.metas[type].byRef.has(ref) && v != null && v !== "") ch[ref] = v; },
  shared(type, map, ch) { map.forEach(({ed}, ref) => this.put(ch, type, ref, ed.get())); },
  async plans() {
    const s = this.s, shared = {};
    s.fEd.forEach(({ed}, ref) => this.put(shared, "Feature", ref, ed.get()));
    const area = shared[BD_REF.area];
    s.stories.forEach(r => { if (r.warn) r.warn.classList.toggle("hidden", !(r.noSprint && r.inc.checked)); });
    const groups = this.groups(); s.groups = groups;
    this.renderFeatures(groups);
    const features = [];
    for (const [k, g] of groups.entries()) {
      const c = s.fcards[g.key], fch = Object.assign({}, shared);
      this.put(fch, "Feature", BD_REF.title, c.title.value.trim());
      this.put(fch, "Feature", BD_REF.iter, g.piPath);
      if (c.spv) this.put(fch, "Feature", BD_REF.spv, c.spv.get());
      const desc = this.featureDescription(g, k, groups.length);
      if (c.preview.dataset.html !== desc) { c.preview.innerHTML = desc; c.preview.dataset.html = desc; }
      this.put(fch, "Feature", BD_REF.desc, desc);
      this.put(fch, "Feature", BD_REF.tags, BD_TAG);
      features.push({g, c, plan: await Edit.plan(this.newItem("Feature"), fch, "")});
    }
    const featOf = new Map(); groups.forEach((g, k) => g.recs.forEach(r => featOf.set(r, k)));
    const stories = [];
    for (const r of s.stories) {
      if (!r.inc.checked) continue;
      const ch = {};
      this.shared("User Story", s.usEd, ch);
      this.put(ch, "User Story", BD_REF.title, r.title.value.trim());
      this.put(ch, "User Story", BD_REF.area, area);
      this.put(ch, "User Story", BD_REF.iter, r.iter ? r.iter.get() : s.defaults.iter);
      const udesc = bdStoryDescription(Object.assign({}, r.story, {title: r.title.value.trim()}), s.b);
      if (r.preview && r.preview.dataset.html !== udesc) { r.preview.innerHTML = udesc; r.preview.dataset.html = udesc; }
      this.put(ch, "User Story", BD_REF.desc, udesc);
      if (r.spv) this.put(ch, "User Story", BD_REF.spv, r.spv.get());
      this.put(ch, "User Story", BD_REF.tags, BD_TAG);
      const plan = await Edit.plan(this.newItem("User Story"), ch, "");
      const tasks = [];
      for (const t of r.tasks) {
        if (!t.inc.checked) continue;
        const tch = {};
        this.shared("Task", s.taskEd, tch);
        this.put(tch, "Task", BD_REF.title, t.title.value.trim());
        this.put(tch, "Task", BD_REF.area, area);
        this.put(tch, "Task", BD_REF.iter, ch[BD_REF.iter]);
        this.put(tch, "Task", BD_REF.est, t.est.value === "" ? null : Number(t.est.value));
        this.put(tch, "Task", BD_REF.tags, BD_TAG);
        tasks.push({t, plan: await Edit.plan(this.newItem("Task"), tch, "")});
      }
      stories.push({r, plan, tasks, fk: featOf.has(r) ? featOf.get(r) : -1});
    }
    return {features, stories};
  },

  refresh() {
    clearTimeout(this._rt);
    this._rt = setTimeout(() => this.check(), 120);
  },
  async check() {
    const s = this.s; if (!s || s.running) return;
    let p;
    try { p = await this.plans(); } catch (e) { $("bcCheck").innerHTML = '<div class="bad">' + escHtml(e.message || String(e)) + "</div>"; return; }
    if (this.s !== s) return;
    // Required fields found only now (process rules that depend on values): ask for them in the right place
    p.features.forEach(x => x.plan.missing.forEach(f => { if (!BD_HANDLED["Feature"].includes(f.ref)) this.addEditor("Feature", f.ref, undefined, s.fGrid, s.fEd, "חובה"); }));
    p.stories.forEach(x => {
      x.plan.missing.forEach(f => { if (!BD_HANDLED["User Story"].includes(f.ref)) this.addEditor("User Story", f.ref, this.featureVal(f.ref), s.usGrid, s.usEd, "חובה"); });
      x.tasks.forEach(y => y.plan.missing.forEach(f => { if (!BD_HANDLED["Task"].includes(f.ref)) this.addEditor("Task", f.ref, this.featureVal(f.ref), s.tGrid, s.taskEd, "חובה"); }));
    });
    const msgs = [];
    if (s.hasEpic == null) msgs.push("יש לענות: האם יש Epic אב?");
    else if (s.hasEpic && !s.epic) msgs.push("חובה לבחור את ה-Epic האב");
    const miss = (plan, who) => {
      if (plan.missing.length) msgs.push(who + ": חסר " + plan.missing.map(f => f.label).join(", "));
      if (plan.template) msgs.push(who + ": בתבנית חסר תוכן תחת " + [...plan.template.missing, ...plan.template.empty].join(", "));
      plan.errors.forEach(e => msgs.push(who + ": " + e));
    };
    const nf = p.features.length;
    p.features.forEach((x, k) => {
      miss(x.plan, nf > 1 ? "Feature " + (k + 1) : "Feature");
      x.c.title.classList.toggle("needed", !x.c.title.value.trim());
    });
    s.fEd.forEach(({row}, ref) => row.classList.toggle("needed", p.features.some(x => x.plan.missing.some(f => f.ref === ref))));
    const lost = s.stories.filter(r => r.inc.checked && r.noSprint).map(r => r.i + 1);
    if (lost.length) msgs.push("אין ספרינט ל-US " + lost.join(", ") + ": ה-PI הבא עוד לא קיים ב-Azure. בחרו להם Iteration, בחרו ספרינט התחלה מוקדם יותר, או הורידו את הסימון.");
    const usMissing = new Set(), taskMissing = new Set();
    let estMissing = 0, tasks = 0;
    p.stories.forEach(x => {
      x.plan.missing.forEach(f => usMissing.add(f.ref));
      if (x.plan.missing.some(f => !s.usEd.has(f.ref))) miss({missing: x.plan.missing.filter(f => !s.usEd.has(f.ref)), errors: [], template: null}, "US " + (x.r.i + 1));
      x.tasks.forEach(y => {
        tasks++;
        const noEst = y.plan.missing.some(f => f.ref === BD_REF.est);
        y.t.est.classList.toggle("needed", noEst); if (noEst) estMissing++;
        y.plan.missing.forEach(f => { if (f.ref !== BD_REF.est) taskMissing.add(f.ref); });
        if (!y.t.title.value.trim()) msgs.push("Task בלי כותרת ב-US " + (x.r.i + 1));
      });
      x.r.title.classList.toggle("needed", !x.r.title.value.trim());
      if (!x.r.title.value.trim()) msgs.push("US " + (x.r.i + 1) + ": חסרה כותרת");
      if (!String(x.r.story.iWant || "").trim()) msgs.push("US " + (x.r.i + 1) + ": חסר \"אני רוצה...\" בניסוח");
    });
    s.usEd.forEach(({row}, ref) => row.classList.toggle("needed", usMissing.has(ref)));
    s.taskEd.forEach(({row}, ref) => row.classList.toggle("needed", taskMissing.has(ref)));
    const usShared = [...usMissing].filter(r => s.usEd.has(r)).map(r => s.usEd.get(r).ed.f.label);
    if (usShared.length) msgs.push("שדות לכל ה-User Stories: חסר " + usShared.join(", "));
    const tShared = [...taskMissing].filter(r => s.taskEd.has(r)).map(r => s.taskEd.get(r).ed.f.label);
    if (tShared.length) msgs.push("שדות לכל ה-Tasks: חסר " + tShared.join(", "));
    if (estMissing) msgs.push("חסר Original Estimate ב-" + (estMissing === 1 ? "Task אחד" : estMissing + " Tasks"));
    if (!p.stories.length) msgs.push("לא נבחר אף User Story");
    const people = $("bcBody").querySelectorAll(".pk-input.invalid, .pk-input.pending").length;
    if (people) msgs.push("יש שדה אנשים שלא נבחר מהרשימה");
    s.p = p; s.ok = !msgs.length;
    s.count = {features: nf, us: p.stories.length, tasks};
    $("bcCheck").innerHTML = msgs.length ? '<div class="bad">' + msgs.slice(0, 8).map(escHtml).join("<br>") + (msgs.length > 8 ? "<br>ועוד " + (msgs.length - 8) + "..." : "") + "</div>"
      : '<div class="ok">הכל מוכן. ייווצרו ' + this.featWord(nf) + ", " + p.stories.length + " User Stories ו-" + tasks + " Tasks.</div>";
    const n = nf + p.stories.length + tasks;
    $("bcGo").disabled = !s.ok;
    $("bcGo").textContent = s.ok ? "יצירת " + n + " פריטים ב-Azure" : "יש להשלים פרטים";
  },

  featWord(n) { return n === 1 ? "Feature אחד" : n + " Features"; },

  /* ---------- creating ---------- */
  ask() {
    const s = this.s; if (!s || !s.ok) return;
    $("bcConfirmText").textContent = "לאשר יצירה ב-Azure DevOps של " + this.featWord(s.count.features) + ", " + s.count.us + " User Stories ו-" + s.count.tasks + " Tasks" + (s.hasEpic && s.epic ? " תחת " + s.epic.id : "") + "? אחרי היצירה אי אפשר לבטל אוטומטית.";
    $("bcGo").classList.add("hidden"); $("bcConfirm").classList.remove("hidden"); $("bcYes").focus();
  },
  back() { $("bcConfirm").classList.add("hidden"); $("bcGo").classList.remove("hidden"); $("bcGo").focus(); },

  async run() {
    const s = this.s; if (!s || s.running) return;
    s.running = true; $("bcYes").disabled = true; $("bcClose").disabled = true;
    let p;
    try { p = await this.plans(); } catch (e) { p = null; }
    const all = p ? [...p.features.map(x => x.plan), ...p.stories.map(x => x.plan), ...p.stories.flatMap(x => x.tasks.map(y => y.plan))] : [];
    if (!p || !p.features.length || !all.every(x => x.ok) || p.stories.some(x => x.fk < 0)) { s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false; this.back(); this.refresh(); return; }
    const total = all.length; let done = 0;
    const prog = document.createElement("div"); prog.className = "bc-prog"; prog.setAttribute("role", "status");
    prog.innerHTML = '<div class="bc-bar"><span></span></div><div class="bc-ptext"></div>';
    $("bcBody").prepend(prog); $("bcBody").scrollTop = 0;
    $("bcConfirm").classList.add("hidden");
    const tick = label => { done++; prog.querySelector(".bc-bar span").style.width = Math.round(done / total * 100) + "%"; prog.querySelector(".bc-ptext").textContent = "נוצרו " + done + " מתוך " + total + (label ? " · " + label : ""); };
    const result = {features: [], failed: []};
    const parentRef = it => ({id: it.id, url: it.url});
    for (const [k, x] of p.features.entries()) {
      const rec = {title: x.c.title.value.trim(), item: null, stories: []};
      try { rec.item = await Create.commit(x.plan, s.hasEpic ? s.epic : null); tick("Feature " + rec.item.id); }
      catch (e) {
        if (k === 0) {        // the first one failed: stop before anything is created
          s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false; prog.remove();
          if (e instanceof RuleError && /Required|InvalidEmpty/i.test(e.codes)) {
            const key = norm(e.field), f = [...s.metas["Feature"].byRef.values()].find(y => norm(y.name) === key || norm(y.label) === key || norm(y.ref.split(".").pop()) === key);
            if (f) { Meta.learnRequired("Feature", f.ref); this.addEditor("Feature", f.ref, undefined, s.fGrid, s.fEd, "חובה"); }
          }
          this.back(); await this.check();
          $("bcCheck").insertAdjacentHTML("afterbegin", '<div class="bad">יצירת ה-Feature נכשלה, לא נוצר שום פריט: ' + escHtml(e.message || String(e)) + "</div>");
          if (e instanceof AuthError) toast(e.message);
          return;
        }
        result.failed.push({what: "Feature: " + rec.title, why: e.message || String(e)}); tick();
      }
      result.features.push(rec);
    }
    for (const x of p.stories) {
      const title = x.r.title.value.trim(), rec = {title, item: null, tasks: []}, feat = result.features[x.fk];
      if (!feat || !feat.item) {
        result.failed.push({what: "US: " + title + " (לא נוצר כי ה-Feature שלו נכשל)", why: ""}); tick();
        x.tasks.forEach(y => { result.failed.push({what: "Task: " + y.t.title.value.trim() + " (לא נוצר כי ה-US נכשל)", why: ""}); tick(); });
        continue;
      }
      feat.stories.push(rec);
      try { rec.item = await Create.commit(x.plan, parentRef(feat.item)); tick("US " + rec.item.id); }
      catch (e) {
        result.failed.push({what: "US: " + title, why: e.message || String(e)});
        x.tasks.forEach(y => { result.failed.push({what: "Task: " + y.t.title.value.trim() + " (לא נוצר כי ה-US נכשל)", why: ""}); tick(); });
        tick(); continue;
      }
      for (const y of x.tasks) {
        const tt = y.t.title.value.trim();
        try { const it = await Create.commit(y.plan, parentRef(rec.item)); rec.tasks.push(it); tick("Task " + it.id); }
        catch (e) { result.failed.push({what: "Task: " + tt, why: e.message || String(e)}); tick(); }
      }
    }
    const created = result.features.flatMap(f => f.item ? [f.item, ...f.stories.map(r => r.item).filter(Boolean), ...f.stories.flatMap(r => r.tasks)] : []);
    People.fromItems(created);
    const f0 = result.features[0].item;
    rememberPaths(f0.fields[BD_REF.area], f0.fields[BD_REF.iter]);
    s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false;
    this.close();
    this.announce(result, created.length);
  },

  link(it) {
    const id = it.id;
    return Auth.mode === "demo" ? "<b>" + id + "</b>" : '<a target="_blank" rel="noopener" href="' + ADO + "/" + encodeURIComponent(it.fields["System.TeamProject"] || TeamConfig.data.project) + "/_workitems/edit/" + id + '"><b>' + id + "</b></a>";
  },
  announce(r, n) {
    let h = '<div class="bc-done"><div class="bc-done-t">' + (r.failed.length ? "⚠ " : "✓ ") + "נוצרו " + n + " פריטים ב-Azure" + (r.failed.length ? ", " + r.failed.length + " לא נוצרו" : "") + "</div>";
    const ids = [];
    r.features.forEach(fr => {
      if (!fr.item) return;
      const f = fr.item; ids.push(f.id);
      h += '<div class="bc-done-f">Feature ' + this.link(f) + " · " + escHtml(f.fields[BD_REF.title] || "") + " · " + escHtml(String(f.fields[BD_REF.iter] || "").split("\\").pop()) + (f.fields["System.Parent"] ? " · תחת " + f.fields["System.Parent"] : "") + "</div><ul>";
      fr.stories.forEach(st => {
        if (!st.item) return;
        ids.push(st.item.id, ...st.tasks.map(t => t.id));
        h += "<li>US " + this.link(st.item) + " · " + escHtml(st.title) + (st.tasks.length ? '<ul class="bc-tl">' + st.tasks.map(t => "<li>Task " + this.link(t) + " · " + escHtml(t.fields[BD_REF.title] || "") + "</li>").join("") + "</ul>" : "") + "</li>";
      });
      h += "</ul>";
    });
    if (r.failed.length) h += '<div class="bc-fail"><b>לא נוצרו:</b><ul>' + r.failed.map(x => "<li>" + escHtml(x.what) + (x.why ? ": " + escHtml(x.why) : "") + "</li>").join("") + "</ul>אפשר ליצור אותם ידנית עם \"+ תת-פריט\".</div>";
    h += '<div class="muted">לכל הפריטים נוספה התגית ' + escHtml(BD_TAG) + '.</div><div class="bc-done-acts"></div></div>';
    const m = addMsg(r.failed.length ? "bot" : "bot ok", h);
    const show = document.createElement("button"); show.type = "button"; show.className = "btn ghost sm"; show.textContent = "הצגה בטבלה";
    show.onclick = () => ChatSearch.show(ids.slice(0, CONFIG.MAX_IDS));
    m.querySelector(".bc-done-acts").appendChild(show);
  },

  init() {
    $("bcClose").onclick = () => this.close();
    $("bcGo").onclick = () => this.ask();
    $("bcYes").onclick = () => this.run();
    $("bcNo").onclick = () => this.back();
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || $("bcPanel").classList.contains("hidden") || !$("lightbox").classList.contains("hidden")) return;
      if (e.target && e.target.closest && e.target.closest(".picker")) return;   // pickers close themselves first
      if (!$("bcConfirm").classList.contains("hidden")) this.back(); else this.close();
    });
  }
};

document.addEventListener("DOMContentLoaded", () => { if (document.getElementById("bcPanel")) BreakdownCreate.init(); });
