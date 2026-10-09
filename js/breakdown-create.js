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
/* Sprints with dates, from the current one on, around the Feature's iteration. */
function bdSprints(tree, featureIter, today) {
  if (!tree) return [];
  const find = (n, p) => n.path === p ? n : (n.children || []).reduce((r, c) => r || find(c, p), null);
  const parentOf = (n, p) => (n.children || []).reduce((r, c) => r || (c.path === p ? n : parentOf(c, p)), null);
  const node = find(tree, featureIter) || tree;
  const scope = node.children && node.children.length ? node : (parentOf(tree, node.path) || tree);
  const anchor = scope === tree ? tree : (parentOf(tree, scope.path) || tree);
  const leaves = [];
  const walk = n => { if (n.children && n.children.length) n.children.forEach(walk); else if (n.start && n.finish) leaves.push(n); };
  walk(anchor);
  const t = today || new Date(); t.setHours(0, 0, 0, 0);
  const from = node.start ? Math.max(t.getTime(), new Date(node.start).getTime() - 86400000) : t.getTime();
  return leaves.filter(l => new Date(l.finish).getTime() + 86400000 > from).sort((a, c) => new Date(a.start) - new Date(c.start));
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
      fEd: new Map(), usEd: new Map(), taskEd: new Map(), touched: new Set(), stories: [], firstSprint: 0, sprints: [], running: false,
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
    intro.innerHTML = "ייווצרו Feature חדש, " + b.stories.length + " User Stories וה-Tasks שלהם. כל הפריטים יקבלו את התגית <b>" + escHtml(BD_TAG) + "</b>. בדקו, השלימו שדות חובה ואשרו. שום דבר לא נשמר לפני האישור.";
    body.appendChild(intro);

    // 1. Feature
    const fs = this.section(body, "1. ה-Feature");
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
    const fm = s.metas["Feature"];
    const spAllowed = (fm.byRef.get(BD_REF.spv) || {}).allowed;
    const fInit = [[BD_REF.title, b.feature.title], [BD_REF.area, s.defaults.area], [BD_REF.iter, s.defaults.iter],
      [BD_REF.spv, bdSpValue(b.feature.sp, spAllowed)], [BD_REF.who, undefined]];
    fInit.forEach(([ref, v]) => this.addEditor("Feature", ref, v, fGrid, s.fEd));
    if (fm.byRef.has(BD_REF.spv)) {
      const hint = document.createElement("div"); hint.className = "bc-hint";
      hint.textContent = "לפי הפירוק: \u2066" + b.feature.sp + " SP\u2069 לפיצ'ר. סך ה-User Stories: \u2066" + b.totalSp + " SP\u2069.";
      const fsel = s.fEd.get(BD_REF.spv).row.querySelector("select"); if (fsel) fsel.dir = "ltr";
      s.fEd.get(BD_REF.spv).row.appendChild(hint);
    }
    this.requiredOf("Feature").forEach(ref => this.addEditor("Feature", ref, undefined, fGrid, s.fEd, "חובה"));
    if (fm.byRef.has(BD_REF.desc)) {
      const d = document.createElement("details"); d.className = "bc-desc";
      d.innerHTML = "<summary>Description של ה-Feature (נבנה מהתבנית ומהפירוק, אפשר לערוך)</summary>";
      fs.appendChild(d);
      this.addEditor("Feature", BD_REF.desc, bdFeatureDescription(b, s.input), d, s.fEd);
    }

    // 2. Shared fields
    const ss = this.section(body, "2. שדות לכל ה-User Stories");
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

    // 3. Stories and tasks
    const st = this.section(body, "3. User Stories ו-Tasks");
    const um = s.metas["User Story"];
    const sprintOf = new Map(); b.sprints.forEach((ix, k) => ix.forEach(i => sprintOf.set(i, k)));
    b.stories.forEach((story, i) => {
      const card = document.createElement("div"); card.className = "bc-us";
      const top = document.createElement("div"); top.className = "bc-us-top";
      const inc = document.createElement("input"); inc.type = "checkbox"; inc.checked = true; inc.setAttribute("aria-label", "ליצור את US " + (i + 1));
      const num = document.createElement("span"); num.className = "bd-num"; num.textContent = "US " + (i + 1);
      const title = document.createElement("input"); title.className = "bc-title"; title.value = story.title; title.setAttribute("aria-label", "כותרת US " + (i + 1));
      top.append(inc, num, title);
      const row = document.createElement("div"); row.className = "bc-us-fields";
      const rec = {story, i, sprint: sprintOf.has(i) ? sprintOf.get(i) : 0, card, inc, title, tasks: [], spv: null, iter: null, iterTouched: false};
      if (um.byRef.has(BD_REF.spv)) {
        const f = um.byRef.get(BD_REF.spv);
        rec.spv = makeEditor(f, bdSpValue(story.sp, f.allowed), {type: "User Story", meta: um, onChange: () => this.refresh()});
        const ssel = rec.spv.el.querySelector("select"); if (ssel) ssel.dir = "ltr";
        row.appendChild(this.labeled("Story Points Values", rec.spv.el, "בפירוק: \u2066" + story.sp + " SP\u2069"));
      }
      const fi = um.byRef.get(BD_REF.iter);
      if (fi) {
        rec.iter = makeEditor(fi, s.defaults.iter, {type: "User Story", meta: um, onChange: () => { rec.iterTouched = true; this.refresh(); }});
        row.appendChild(this.labeled("Iteration", rec.iter.el, "ספרינט " + (rec.sprint + 1) + " בתכנון"));
      }
      const tl = document.createElement("div"); tl.className = "bc-tasks";
      story.tasks.forEach((t, k) => {
        const tr = document.createElement("div"); tr.className = "bc-task";
        const tinc = document.createElement("input"); tinc.type = "checkbox"; tinc.checked = true; tinc.setAttribute("aria-label", "ליצור את ה-Task");
        const tt = document.createElement("input"); tt.className = "bc-title"; tt.value = t.title; tt.setAttribute("aria-label", "כותרת Task " + (k + 1) + " של US " + (i + 1));
        const est = document.createElement("input"); est.type = "number"; est.min = "0"; est.step = "0.5"; est.className = "bc-est"; est.placeholder = "שעות";
        est.setAttribute("aria-label", "Original Estimate (שעות) של " + t.title);
        if (t.hours != null && t.hours !== "") est.value = t.hours;
        [tinc, tt, est].forEach(x => x.addEventListener(x.type === "checkbox" ? "change" : "input", () => this.refresh()));
        tr.append(tinc, tt, est); tl.appendChild(tr);
        rec.tasks.push({inc: tinc, title: tt, est, row: tr});
      });
      const th = document.createElement("div"); th.className = "bc-th"; th.innerHTML = "<span>Tasks</span><span>Original Estimate (שעות)</span>";
      const dd = document.createElement("details"); dd.className = "bc-desc";
      dd.innerHTML = "<summary>Description של ה-US</summary>";
      const pv = document.createElement("div"); pv.className = "bc-preview"; pv.innerHTML = bdStoryDescription(story, b); dd.appendChild(pv);
      card.append(top, row, dd, th, tl);
      inc.onchange = () => { card.classList.toggle("off", !inc.checked); this.refresh(); };
      title.oninput = () => this.refresh();
      st.appendChild(card);
      s.stories.push(rec);
    });
    this.updateSprints();
    $("bcFoot").classList.remove("hidden");
    $("bcConfirm").classList.add("hidden");
    $("bcGo").classList.remove("hidden");
    this.refresh();
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
    if (ref === BD_REF.iter) this.updateSprints();
  },

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
    [[BD_REF.area, f["System.AreaPath"]], [BD_REF.iter, f["System.IterationPath"]]].forEach(([ref, v]) => {
      const e = s.fEd.get(ref); if (e && v && !s.touched.has("Feature|" + ref)) { e.ed.set(v); this.featureChanged(ref); }
    });
    this.refresh();
  },

  /* ---------- sprints ---------- */
  updateSprints() {
    const s = this.s;
    s.sprints = bdSprints(s.tree, this.featureVal(BD_REF.iter), this.today ? new Date(this.today) : null);
    const sel = s.firstSel; sel.innerHTML = "";
    s.sprints.forEach((n, k) => sel.add(new Option(n.path.split("\\").slice(-2).join(" \\ ") + " (" + bdDate(n.start) + "–" + bdDate(n.finish) + ")" + (new Date(n.start) <= (this.today ? new Date(this.today) : new Date()) ? " · נוכחי" : ""), String(k))));
    if (!s.sprints.length) sel.add(new Option("לא נמצאו ספרינטים עם תאריכים", "0"));
    s.firstSprint = Math.min(s.firstSprint, Math.max(0, s.sprints.length - 1)); sel.value = String(s.firstSprint);
    sel.disabled = !s.sprints.length;
    s.sprNote.textContent = s.sprints.length ? "כל US מקבל ספרינט לפי התכנון (ספרינט 1, 2...). אפשר לשנות לכל US בנפרד." : "ה-User Stories יקבלו את ה-Iteration של ה-Feature. אפשר לשנות לכל US בנפרד.";
    this.assignSprints();
  },
  assignSprints() {
    const s = this.s;
    s.stories.forEach(r => {
      if (!r.iter || r.iterTouched) return;
      const n = s.sprints.length ? s.sprints[Math.min(s.firstSprint + r.sprint, s.sprints.length - 1)] : null;
      r.iter.set(n ? n.path : this.featureVal(BD_REF.iter));
    });
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
    const s = this.s, fch = {};
    s.fEd.forEach(({ed}, ref) => this.put(fch, "Feature", ref, ed.get()));
    this.put(fch, "Feature", BD_REF.tags, BD_TAG);
    const area = fch[BD_REF.area];
    const feature = await Edit.plan(this.newItem("Feature"), fch, "");
    const stories = [];
    for (const r of s.stories) {
      if (!r.inc.checked) continue;
      const ch = {};
      // Feature values first for fields the US shares with it, then the shared US fields
      this.shared("User Story", s.usEd, ch);
      this.put(ch, "User Story", BD_REF.title, r.title.value.trim());
      this.put(ch, "User Story", BD_REF.area, area);
      this.put(ch, "User Story", BD_REF.iter, r.iter ? r.iter.get() : fch[BD_REF.iter]);
      this.put(ch, "User Story", BD_REF.desc, bdStoryDescription(Object.assign({}, r.story, {title: r.title.value.trim()}), s.b));
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
      stories.push({r, plan, tasks});
    }
    return {feature, stories};
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
    p.feature.missing.forEach(f => { if (!BD_HANDLED["Feature"].includes(f.ref)) this.addEditor("Feature", f.ref, undefined, s.fGrid, s.fEd, "חובה"); });
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
    miss(p.feature, "Feature");
    s.fEd.forEach(({row}, ref) => row.classList.toggle("needed", p.feature.missing.some(f => f.ref === ref)));
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
    s.count = {us: p.stories.length, tasks};
    $("bcCheck").innerHTML = msgs.length ? '<div class="bad">' + msgs.slice(0, 8).map(escHtml).join("<br>") + (msgs.length > 8 ? "<br>ועוד " + (msgs.length - 8) + "..." : "") + "</div>"
      : '<div class="ok">הכל מוכן. ייווצרו Feature אחד, ' + p.stories.length + " User Stories ו-" + tasks + " Tasks.</div>";
    const n = 1 + p.stories.length + tasks;
    $("bcGo").disabled = !s.ok;
    $("bcGo").textContent = s.ok ? "יצירת " + n + " פריטים ב-Azure" : "יש להשלים פרטים";
  },

  /* ---------- creating ---------- */
  ask() {
    const s = this.s; if (!s || !s.ok) return;
    $("bcConfirmText").textContent = "לאשר יצירה ב-Azure DevOps של Feature אחד, " + s.count.us + " User Stories ו-" + s.count.tasks + " Tasks" + (s.hasEpic && s.epic ? " תחת " + s.epic.id : "") + "? אחרי היצירה אי אפשר לבטל אוטומטית.";
    $("bcGo").classList.add("hidden"); $("bcConfirm").classList.remove("hidden"); $("bcYes").focus();
  },
  back() { $("bcConfirm").classList.add("hidden"); $("bcGo").classList.remove("hidden"); $("bcGo").focus(); },

  async run() {
    const s = this.s; if (!s || s.running) return;
    s.running = true; $("bcYes").disabled = true; $("bcClose").disabled = true;
    let p;
    try { p = await this.plans(); } catch (e) { p = null; }
    const all = p ? [p.feature, ...p.stories.map(x => x.plan), ...p.stories.flatMap(x => x.tasks.map(y => y.plan))] : [];
    if (!p || !all.every(x => x.ok)) { s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false; this.back(); this.refresh(); return; }
    const total = all.length; let done = 0;
    const prog = document.createElement("div"); prog.className = "bc-prog"; prog.setAttribute("role", "status");
    prog.innerHTML = '<div class="bc-bar"><span></span></div><div class="bc-ptext"></div>';
    $("bcBody").prepend(prog); $("bcBody").scrollTop = 0;
    $("bcConfirm").classList.add("hidden");
    const tick = label => { done++; prog.querySelector(".bc-bar span").style.width = Math.round(done / total * 100) + "%"; prog.querySelector(".bc-ptext").textContent = "נוצרו " + done + " מתוך " + total + (label ? " · " + label : ""); };
    const result = {feature: null, stories: [], failed: []};
    const parentRef = it => ({id: it.id, url: it.url});
    try {
      result.feature = await Create.commit(p.feature, s.hasEpic ? s.epic : null);
      tick("Feature " + result.feature.id);
    } catch (e) {
      s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false; prog.remove();
      if (e instanceof RuleError && /Required|InvalidEmpty/i.test(e.codes)) {
        const key = norm(e.field), f = [...s.metas["Feature"].byRef.values()].find(x => norm(x.name) === key || norm(x.label) === key || norm(x.ref.split(".").pop()) === key);
        if (f) { Meta.learnRequired("Feature", f.ref); this.addEditor("Feature", f.ref, undefined, s.fGrid, s.fEd, "חובה"); }
      }
      this.back(); await this.check();
      $("bcCheck").insertAdjacentHTML("afterbegin", '<div class="bad">יצירת ה-Feature נכשלה, לא נוצר שום פריט: ' + escHtml(e.message || String(e)) + "</div>");
      if (e instanceof AuthError) toast(e.message);
      return;
    }
    for (const x of p.stories) {
      const title = x.r.title.value.trim(), rec = {title, item: null, tasks: []};
      result.stories.push(rec);
      try { rec.item = await Create.commit(x.plan, parentRef(result.feature)); tick("US " + rec.item.id); }
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
    const created = [result.feature, ...result.stories.map(r => r.item).filter(Boolean), ...result.stories.flatMap(r => r.tasks)];
    People.fromItems(created);
    rememberPaths(result.feature.fields[BD_REF.area], result.feature.fields[BD_REF.iter]);
    s.running = false; $("bcYes").disabled = false; $("bcClose").disabled = false;
    this.close();
    this.announce(result, created.length);
  },

  link(it) {
    const id = it.id;
    return Auth.mode === "demo" ? "<b>" + id + "</b>" : '<a target="_blank" rel="noopener" href="' + ADO + "/" + encodeURIComponent(it.fields["System.TeamProject"] || TeamConfig.data.project) + "/_workitems/edit/" + id + '"><b>' + id + "</b></a>";
  },
  announce(r, n) {
    const f = r.feature;
    let h = '<div class="bc-done"><div class="bc-done-t">' + (r.failed.length ? "⚠ " : "✓ ") + "נוצרו " + n + " פריטים ב-Azure" + (r.failed.length ? ", " + r.failed.length + " לא נוצרו" : "") + "</div>" +
      "<div>Feature " + this.link(f) + " · " + escHtml(f.fields[BD_REF.title] || "") + (f.fields["System.Parent"] ? " · תחת " + f.fields["System.Parent"] : "") + "</div><ul>";
    r.stories.forEach(st => {
      if (!st.item) return;
      h += "<li>US " + this.link(st.item) + " · " + escHtml(st.title) + (st.tasks.length ? '<ul class="bc-tl">' + st.tasks.map(t => "<li>Task " + this.link(t) + " · " + escHtml(t.fields[BD_REF.title] || "") + "</li>").join("") + "</ul>" : "") + "</li>";
    });
    h += "</ul>";
    if (r.failed.length) h += '<div class="bc-fail"><b>לא נוצרו:</b><ul>' + r.failed.map(x => "<li>" + escHtml(x.what) + (x.why ? ": " + escHtml(x.why) : "") + "</li>").join("") + "</ul>אפשר ליצור אותם ידנית עם \"+ תת-פריט\".</div>";
    h += '<div class="muted">לכל הפריטים נוספה התגית ' + escHtml(BD_TAG) + '.</div><div class="bc-done-acts"></div></div>';
    const m = addMsg(r.failed.length ? "bot" : "bot ok", h);
    const show = document.createElement("button"); show.type = "button"; show.className = "btn ghost sm"; show.textContent = "הצגה בטבלה";
    const ids = [f.id, ...r.stories.filter(x => x.item).flatMap(x => [x.item.id, ...x.tasks.map(t => t.id)])];
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
