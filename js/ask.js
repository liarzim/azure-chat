"use strict";
/* ============================================================
   Ask Azuri: a free question in Hebrew (or English) becomes a work item query.
   "מה המשימות הפתוחות שלי בספרינט הנוכחי" → Task · assigned to me · open · current sprint.
   Rules only (no AI): the question is read with fixed patterns plus names taken from Azure
   (squads, areas, people) and the team dictionary (synonyms, Hebrew squad names).
   What was understood is shown as chips; the user removes what is wrong and runs it.
   Defaults: open items only, current PI. Up to 200 results. Read only.
   ============================================================ */

const ASK_MAX = 200;
const ASK_BLOCKED = ["Blocked", "Inactive"];
const ASK_CUE = /(^|\s)(מה|מי|איזה|איזו|אילו|איפה|היכן|כמה|תראה|תראי|הצג|הציגי|הראה|תביא|תביאי|show|list|which|what|where)(?=\s|$)/i;
const ASK_STOP = new Set(("מה מי איזה איזו אילו איפה היכן כמה יש אין את של עם על אל תראה תראי הצג הציגי הראה תביא תביאי תן תני לי אני כל כולם " +
  "ה ו ב ל גם רק או וגם התייחסות התייחסויות מתייחס מתייחסים מוזכר מוזכרים מוזכרת נזכר פריטים פריט שיש בהם בהן בו בה הם הן זה זו אלה אלו " +
  "items item show me what where which the in of to all list are is with for my any about פתוח פתוחים פתוחות פתוחה עכשיו כרגע קיים קיימים לנו אצלנו שלנו").split(" "));

/* Hebrew word forms: drop one prefix letter (ו ה ב ל כ ש) and a plural ending, so "בממשקים" → "ממשק" */
function askStem(w) {
  let s = String(w).trim();
  if (/^[֐-׿]/.test(s)) {
    if (s.length >= 5 && /^[והבלכש]/.test(s)) s = s.slice(1);
    if (s.length >= 5 && /(ים|ות)$/.test(s)) s = s.slice(0, -2);
  }
  return s;
}

const Ask = {
  /* ---------- reading the question ---------- */
  async parse(text) {
    let t = " " + String(text || "").toLowerCase().replace(/[״"]/g, "").replace(/[?!.,;:()]/g, " ").replace(/\s+/g, " ").trim() + " ";
    const c = {words: [], squads: [], areas: [], types: []};
    const take = (re, fn) => { const m = re.exec(t); if (!m) return false; t = t.slice(0, m.index) + " " + t.slice(m.index + m[0].length); fn(m); return true; };
    const W = p => new RegExp("(?:^|\\s)(?:" + p + ")(?=\\s|$)", "i");
    const cue = ASK_CUE.test(t);

    // parent: "הילדים של 112494", "תחת 112494"
    take(W("(?:ה?ילדים של|תחת|מתחת ל-?|children of|under)\\s*#?(\\d{3,})"), m => { c.parent = +m[1]; });
    // blocked / closed / also closed
    if (!take(W("(?:ה?חסומ\\S*|blocked|inactive|לא פעיל\\S*)"), () => { c.state = "blocked"; })) {
      if (!take(W("(?:גם|כולל|וגם)\\s+(?:ה?סגור\\S*|closed)|including closed"), () => { c.state = "all"; })) {
        take(W("(?:ה?סגור\\S*|ש?נסגר\\S*|closed|done)"), () => { c.state = "closed"; c.closedVerb = true; });
      }
    }
    // "open" said out loud (the default anyway)
    take(W("ה?פתוח\\S*|open"), () => { if (!c.state) c.state = "open"; });
    // my squad
    if (take(W("(?:ב?ה?סקוואד(?:ים)? שלי|my squads?)"), () => {})) {
      try { const st = await Perm.ready(); c.squads.push(...st.squads); c.mySquad = true; } catch (e) {}
    }
    // created by me / unassigned / mine
    take(W("(?:ש?פתחתי|ש?יצרתי|created by me)"), () => { c.createdByMe = true; });
    take(W("(?:ש?לא|בלי|ללא)\\s+(?:שוי[כך]\\S*|משוי[כך]\\S*|הוקצ\\S*|מוקצ\\S*|אחראי)|unassigned"), () => { c.assignee = {none: true}; });
    // missing estimates
    take(W("(?:בלי|ללא)\\s+(?:story points|sp|הערכה|נקודות)"), () => { c.missing = "sp"; });
    take(W("(?:בלי|ללא)\\s+(?:שעות|הערכת שעות|original estimate)"), () => { c.missing = "hours"; });
    // tag
    take(W("(?:עם\\s+)?(?:תגית|tag)\\s+(\\S+)"), m => { c.tag = m[1]; });
    // stale: "לא זז 30 יום"
    take(W("(?:לא|שלא)\\s+(?:זז|זזו|עודכנ?\\S*|השתנ\\S*|התקדמ\\S*|נגעו)\\s+(?:כבר\\s+)?(?:ב-?)?(\\d+)\\s+(?:יום|ימים|days?)"), m => { c.stale = +m[1]; });
    // date words; the verb says which date
    const verb = /(נפתח|נוצר|חדש|נוספ|created|opened|new)/.test(t) ? "created" : (c.closedVerb || /(נסגר|הסתיים|closed)/.test(t)) ? "closed" : "changed";
    take(W("(?:ב-?)?(\\d+)\\s+(?:ה)?(?:ימים|יום)\\s+ה?אחרונים|last (\\d+) days"), m => { c.date = {field: verb, from: -(+(m[1] || m[2]))}; });
    take(W("(?:ב)?שבוע שעבר|last week"), () => { c.date = {field: verb, week: -1}; });
    take(W("ה?שבוע(?: ה?זה)?|this week"), () => { c.date = {field: verb, week: 0}; });
    take(W("ה?חודש(?: ה?זה)?|this month"), () => { c.date = {field: verb, month: 0}; });
    take(W("ה?יום|today"), () => { c.date = {field: verb, from: 0}; });
    take(W("(?:ש?נפתח\\S*|ש?נוצר\\S*|ש?נוספ\\S*|חדשים|חדשות|created|opened)"), () => { if (!c.date) c.created = true; });
    // time scope
    take(W("(?:ב?ה?ספרינט|sprint)\\s+(?:ה?(נוכחי|זה|הבא|קודם|שעבר)|(current|next|previous|last))"), m => {
      const w = m[1] || m[2]; c.scope = {kind: "sprint", rel: /הבא|next/.test(w) ? 1 : /קודם|שעבר|previous|last/.test(w) ? -1 : 0};
    });
    take(W("(?:ב?ה?-?pi)\\s+(?:ה?(נוכחי|זה|הבא|קודם|שעבר)|(current|next|previous|last))"), m => {
      const w = m[1] || m[2]; c.scope = {kind: "pi", rel: /הבא|next/.test(w) ? 1 : /קודם|שעבר|previous|last/.test(w) ? -1 : 0};
    });
    take(W("(?:ב?כל ה-?pis?|ב?כל ה-?pi|כל הזמנים|בלי pi|all pis?|any pi)"), () => { c.scope = {kind: "all"}; });
    const paths = await this.paths();
    (paths.pis || []).forEach(p => { if (!c.scope) take(W("(?:ב-?)?" + this.esc(p.name.toLowerCase())), () => { c.scope = {kind: "path", path: p.path, name: p.name}; }); });
    // types
    // "משימות" may mean any work: ask which type (Feature / User Story / Task / all)
    c.ask = [];
    if (take(W("[והב]?(?:ה)?(?:משימה|משימות)"), () => {})) c.ask.push({k: "type", word: "משימות"});
    const TYPES = [["Task", "ה?טאסק\\S*|tasks?"], ["Bug", "באג\\S*|bugs?"], ["User Story", "user stor(?:y|ies)|us|ה?סטורי\\S*|סיפור\\S* משתמש"],
      ["Feature", "פיצ'?ר\\S*|פיצרים|features?"], ["Epic", "אפיק\\S*|epics?"]];
    TYPES.forEach(([type, p]) => { while (take(W("[והב]?(?:ה)?(?:" + p + ")"), () => {})) { if (!c.types.includes(type)) c.types.push(type); } });
    // squads: Leading Squad names from Azure, and their Hebrew names from the dictionary
    const dict = normalizeDictionary(TeamConfig.data.dictionary);
    const squadNames = await this.squadNames();
    const squadWords = [];
    squadNames.forEach(s => squadWords.push([s, s]));
    dict.filter(d => d.kind === "squad" && d.target).forEach(d => d.words.forEach(w => squadWords.push([w.replace(/[״"]/g, ""), d.target])));
    squadWords.sort((a, b) => b[0].length - a[0].length).forEach(([w, s]) => {
      const p = "(?:ב|ה|ל|של\\s+|סקוואד\\s+|בסקוואד\\s+|ה?סקוואד\\s+של\\s+)?(?:ה)?" + this.esc(w.toLowerCase());
      if (take(W(p), m => { if (/סקוואד|squad/.test(m[0])) c.squadField = true; })) { if (!c.squads.includes(s)) c.squads.push(s); }
    });
    // "סקוואד X" with a name we do not know (e.g. "מטאור"): ask which squad it is
    take(W("(?:ב|של\\s+|ל)?ה?סקוואד(?:\\s+של)?\\s+([^\\s\\d]{2,})"), m => {
      if (ASK_STOP.has(m[1])) return;
      c.ask.push({k: "squad", word: m[1]}); c.squadField = true;
    });
    take(W("(?:ב|של\\s+|ל)?ה?סקוואד(?:ים)?"), () => {});
    // areas by name (e.g. "Meteor Sigma", "LOG")
    (paths.areas || []).filter(a => a.name.length >= 3).sort((a, b) => b.name.length - a.name.length).forEach(a => {
      if (take(W("(?:ב|ב-|area\\s+)?" + this.esc(a.name.toLowerCase())), () => {})) c.areas.push(a.path);
    });
    // people: "של דנה", "אצל יוסי לוי"
    if (!c.assignee) {
      let people = [];
      try { people = await People.all(); } catch (e) {}
      for (const p of people) {
        const full = String(p.displayName || "").toLowerCase(), first = full.split(" ")[0];
        if (!first || first.length < 2) continue;
        if (take(W("(?:של|אצל|ל-?|assigned to|שויכו ל-?|משויכ\\S* ל-?)\\s*" + this.esc(full)), () => {}) ||
            take(W("(?:של|אצל|assigned to)\\s+" + this.esc(first)), () => {})) { c.assignee = {person: p}; break; }
      }
    }
    // mine
    if (!c.assignee) take(W("(?:שלי|אצלי|my|mine)"), () => { c.assignee = {me: true}; });
    // the rest: words to look for in the title and description
    t.split(/\s+/).filter(Boolean).forEach(w => {
      if (ASK_STOP.has(w) || /^\d+$/.test(w) || w.length < 2) return;
      if (/^(ב|ה|ל|ו|ש)$/.test(w)) return;
      if (!c.words.includes(w)) c.words.push(w);
    });
    c.words = c.words.map(w => this.expand(w, dict));
    c.strong = cue || c.ask.length > 0 || !!(c.parent || c.state || c.assignee || c.createdByMe || c.missing || c.tag || c.stale || c.date || c.created || c.scope || c.types.length || c.squads.length || c.areas.length);
    return c;
  },
  esc(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+"); },
  /* a word and its synonyms (dictionary groups) */
  expand(w, dict) {
    const st = norm(askStem(w));
    const g = dict.find(d => d.kind === "words" && d.words.some(x => norm(askStem(x)) === st || norm(x) === norm(w)));
    const all = [], seen = new Set();
    (g ? [w, ...g.words] : [w]).forEach(x => { const k = norm(askStem(x)); if (!seen.has(k)) { seen.add(k); all.push(x); } });
    return {word: w, all};
  },
  async squadNames() {
    try { const m = await Meta.typeMeta("User Story"); const f = m.byRef.get(PERM_SQUAD); return (f && f.allowed) || []; } catch (e) { return []; }
  },
  /* Area nodes and PIs (iterations whose children are sprints) with dates */
  async paths() {
    if (this._paths) return this._paths;
    const out = {areas: [], pis: [], sprints: []};
    try {
      const tr = (await Meta.classPaths()).trees;
      const walkA = (n, d) => { if (d > 0) out.areas.push({name: n.name, path: n.path}); (n.children || []).forEach(x => walkA(x, d + 1)); };
      if (tr.area) walkA(tr.area, 0);
      const walkI = n => {
        const kids = n.children || [];
        if (kids.length && kids.every(k => !(k.children || []).length)) { out.pis.push({name: n.name, path: n.path, start: n.start, finish: n.finish}); kids.forEach(k => out.sprints.push({name: k.name, path: k.path, start: k.start, finish: k.finish})); }
        else kids.forEach(walkI);
      };
      if (tr.iteration) walkI(tr.iteration);
    } catch (e) {}
    this._paths = out;
    return out;
  },
  today: null,           // tests can pin "today"
  now() { const d = this.today ? new Date(this.today) : new Date(); d.setHours(0, 0, 0, 0); return d; },
  ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); },
  /* current / next / previous sprint or PI, from the iteration dates */
  pick(list, rel) {
    const t = this.now().getTime();
    const dated = list.filter(x => x.start && x.finish).sort((a, b) => new Date(a.start) - new Date(b.start));
    const i = dated.findIndex(x => new Date(x.start).getTime() <= t && t < new Date(x.finish).getTime() + 86400000);
    if (i < 0) return null;
    const cur = dated[i];
    if (rel === 0) return dated.filter(x => x.start === cur.start && x.finish === cur.finish);   // teams may share dates
    const other = rel > 0 ? dated.filter(x => new Date(x.start) > new Date(cur.finish)) : dated.filter(x => new Date(x.finish) < new Date(cur.start)).reverse();
    if (!other.length) return null;
    return dated.filter(x => x.start === other[0].start && x.finish === other[0].finish);
  },
  dateRange(d) {
    const t = this.now();
    if (d.from !== undefined) { const f = new Date(t); f.setDate(f.getDate() + d.from); return {from: f}; }
    if (d.week !== undefined) { const s = new Date(t); s.setDate(s.getDate() - s.getDay() + 7 * d.week); const e = new Date(s); e.setDate(e.getDate() + 7); return d.week < 0 ? {from: s, to: e} : {from: s}; }
    if (d.month !== undefined) { const s = new Date(t.getFullYear(), t.getMonth(), 1); return {from: s}; }
    return {};
  },

  /* ---------- what the query will be (with defaults) ---------- */
  async resolve(c) {
    const r = Object.assign({}, c);
    if (!r.state) r.state = "open";
    // the default scope is the current PI, unless the question says otherwise
    if (!r.scope && !r.parent && !r.date && !r.stale && !r.created) r.scope = {kind: "pi", rel: 0, auto: true};
    const p = await this.paths();
    r.iterations = null;
    if (r.scope && r.scope.kind === "path") r.iterations = [{path: r.scope.path, name: r.scope.name}];
    else if (r.scope && (r.scope.kind === "pi" || r.scope.kind === "sprint")) {
      const got = this.pick(r.scope.kind === "pi" ? p.pis : p.sprints, r.scope.rel);
      r.iterations = got ? got.map(x => ({path: x.path, name: x.name})) : [];
      if (!got && r.scope.auto) { r.scope = null; r.iterations = null; }    // no dated PIs: do not limit
    }
    r.squadAreas = [];
    if (r.squads.length && !r.mySquad && !r.squadField) { try { r.squadAreas = (await SquadAreas.many(r.squads)).map(a => a.path); } catch (e) {} }
    if (r.mySquad) { try { const st = await Perm.ready(); r.squadAreas = st.areas.map(a => a.path); } catch (e) {} }
    return r;
  },

  chips(r) {
    const out = [];
    const sc = {0: "נוכחי", 1: "הבא", "-1": "קודם"};
    if (r.types.length) out.push({k: "types", label: r.types.join(" / ")});
    if (r.assignee) out.push({k: "assignee", label: r.assignee.me ? "שויך אליי" : r.assignee.none ? "לא שויך" : "שויך ל" + r.assignee.person.displayName});
    if (r.createdByMe) out.push({k: "createdByMe", label: "פתחתי אני"});
    if (r.squads.length) out.push({k: "squads", label: (r.mySquad ? "הסקוואדים שלי: " : r.squadField ? "Leading Squad: " : "Squad: ") + r.squads.join(", ")});
    if (r.areas.length) out.push({k: "areas", label: "Area: " + r.areas.map(a => a.split("\\").pop()).join(", ")});
    out.push({k: "state", label: {open: "פתוחים", closed: "סגורים", blocked: "חסומים (Blocked / Inactive)", all: "פתוחים וסגורים"}[r.state]});
    if (r.scope && r.scope.kind !== "all") {
      const names = (r.iterations || []).map(x => x.name).join(", ");
      out.push({k: "scope", label: r.scope.kind === "path" ? names : (r.scope.kind === "pi" ? "PI " : "ספרינט ") + sc[r.scope.rel] + (names ? " (" + names + ")" : " (לא נמצא)")});
    }
    if (r.parent) out.push({k: "parent", label: "תחת " + r.parent});
    if (r.date) { const rg = this.dateRange(r.date); out.push({k: "date", label: {created: "נפתחו", closed: "נסגרו", changed: "עודכנו"}[r.date.field] + " מ-" + fmtDate(rg.from) + (rg.to ? " עד " + fmtDate(new Date(rg.to.getTime() - 86400000)) : "")}); }
    if (r.stale) out.push({k: "stale", label: "לא עודכנו " + r.stale + " יום"});
    if (r.missing) out.push({k: "missing", label: r.missing === "sp" ? "בלי Story Points" : "בלי הערכת שעות"});
    if (r.tag) out.push({k: "tag", label: "תגית: " + r.tag});
    r.words.forEach((w, i) => out.push({k: "word" + i, label: "מילים: " + w.all.join(" / ")}));
    return out;
  },
  drop(c, k) {
    if (k === "types") c.types = [];
    else if (k === "squads") { c.squads = []; c.mySquad = false; }
    else if (k === "areas") c.areas = [];
    else if (k === "state") c.state = "all";
    else if (k === "scope") c.scope = {kind: "all"};
    else if (/^word\d+$/.test(k)) c.words.splice(+k.slice(4), 1);
    else delete c[k];
  },

  /* ---------- the query ---------- */
  async wiql(r, withDescription) {
    const q = s => "'" + String(s).replace(/'/g, "''") + "'";
    const w = ["[System.TeamProject] = @project"];
    if (r.types.length) w.push("[System.WorkItemType] IN (" + r.types.map(q).join(", ") + ")");
    if (r.assignee && r.assignee.me) w.push("[System.AssignedTo] = @Me");
    if (r.assignee && r.assignee.none) w.push("[System.AssignedTo] = ''");
    if (r.assignee && r.assignee.person) w.push("[System.AssignedTo] = " + q(r.assignee.person.uniqueName));
    if (r.createdByMe) w.push("[System.CreatedBy] = @Me");
    if (r.state === "open") w.push("[System.State] NOT IN (" + SEARCH_CLOSED.map(q).join(", ") + ")");
    if (r.state === "closed") w.push("[System.State] IN (" + SEARCH_CLOSED.map(q).join(", ") + ")");
    if (r.state === "blocked") w.push("[System.State] IN (" + ASK_BLOCKED.map(q).join(", ") + ")");
    if (r.iterations) w.push(r.iterations.length ? "(" + r.iterations.map(x => "[System.IterationPath] UNDER " + q(x.path)).join(" OR ") + ")" : "[System.Id] = 0");
    if (r.squads.length) w.push("(" + ["[" + PERM_SQUAD + "] IN (" + r.squads.map(q).join(", ") + ")", ...r.squadAreas.map(a => "[System.AreaPath] UNDER " + q(a))].join(" OR ") + ")");
    if (r.areas.length) w.push("(" + r.areas.map(a => "[System.AreaPath] UNDER " + q(a)).join(" OR ") + ")");
    if (r.parent) w.push("[System.Parent] = " + (+r.parent));
    if (r.tag) w.push("[System.Tags] CONTAINS " + q(r.tag));
    const field = {created: "[System.CreatedDate]", closed: "[Microsoft.VSTS.Common.ClosedDate]", changed: "[System.ChangedDate]"};
    if (r.date) { const rg = this.dateRange(r.date); w.push(field[r.date.field] + " >= " + q(this.ymd(rg.from))); if (rg.to) w.push(field[r.date.field] + " < " + q(this.ymd(rg.to))); }
    if (r.created && !r.date) { const f = this.now(); f.setDate(f.getDate() - 7); w.push("[System.CreatedDate] >= " + q(this.ymd(f))); }
    if (r.stale) { const f = this.now(); f.setDate(f.getDate() - r.stale); w.push("[System.ChangedDate] < " + q(this.ymd(f))); }
    if (r.missing === "sp") {
      let ref = "Microsoft.VSTS.Scheduling.StoryPoints";
      try { const m = await Meta.typeMeta("User Story"); if (m.byRef.has("Custom.StoryPointsValues")) ref = "Custom.StoryPointsValues"; } catch (e) {}
      w.push("[" + ref + "] = ''");
      if (!r.types.length) w.push("[System.WorkItemType] = 'User Story'");
    }
    if (r.missing === "hours") { w.push("[Microsoft.VSTS.Scheduling.OriginalEstimate] = ''"); if (!r.types.length) w.push("[System.WorkItemType] = 'Task'"); }
    r.words.forEach(g => {
      const parts = [];
      g.all.forEach(x => {
        parts.push("[System.Title] CONTAINS " + q(askStem(x)));
        if (withDescription) parts.push("[System.Description] CONTAINS WORDS " + q(askStem(x) + "*"));
      });
      w.push("(" + parts.join(" OR ") + ")");
    });
    return "SELECT [System.Id] FROM WorkItems WHERE " + w.join(" AND ") + " ORDER BY [System.ChangedDate] DESC";
  },

  async ids(r) {
    if (Auth.mode === "demo") return this.demo(r);
    const url = Meta.projectUrl() + "/_apis/wit/wiql?$top=" + (ASK_MAX + 1) + "&api-version=7.1";
    let w, titleOnly = false;
    try { w = await apiSend("POST", url, {query: await this.wiql(r, true)}, "application/json"); }
    catch (e) {
      if (!r.words.length) throw e;
      titleOnly = true;          // full-text search on the description is not available: title only
      w = await apiSend("POST", url, {query: await this.wiql(r, false)}, "application/json");
    }
    return {ids: (w.workItems || []).map(x => x.id), titleOnly};
  },
  /* demo: the same rules on the demo items */
  async demo(r) {
    const pool = [];
    for (let i = 110040; i <= 110060; i++) pool.push(i);
    for (let i = 112070; i <= 112085; i++) pool.push(i);
    pool.push(900001, 900002);
    const items = (await fetchItems(pool)).concat([...DemoDB.map.values()].filter(it => it.id >= 300001));
    const t = this.now(), day = 86400000;
    const ok = it => {
      const f = it.fields, st = f["System.State"], who = f["System.AssignedTo"];
      if (r.types.length && !r.types.includes(f["System.WorkItemType"])) return false;
      if (r.state === "open" && SEARCH_CLOSED.includes(st)) return false;
      if (r.state === "closed" && !SEARCH_CLOSED.includes(st)) return false;
      if (r.state === "blocked" && !ASK_BLOCKED.includes(st)) return false;
      if (r.assignee && r.assignee.me && !(who && who.uniqueName === Auth.userEmail)) return false;
      if (r.assignee && r.assignee.none && who) return false;
      if (r.assignee && r.assignee.person && !(who && who.uniqueName === r.assignee.person.uniqueName)) return false;
      const under = (p, root) => { p = String(p || "").toLowerCase(); root = root.toLowerCase(); return p === root || p.startsWith(root + "\\"); };
      if (r.iterations && !r.iterations.some(x => under(f["System.IterationPath"], x.path))) return false;
      if (r.squads.length && !(r.squads.includes(f[PERM_SQUAD]) || r.squadAreas.some(a => under(f["System.AreaPath"], a)))) return false;
      if (r.areas.length && !r.areas.some(a => under(f["System.AreaPath"], a))) return false;
      if (r.parent && f["System.Parent"] !== r.parent) return false;
      if (r.tag && !String(f["System.Tags"] || "").toLowerCase().includes(r.tag.toLowerCase())) return false;
      if (r.stale && new Date(f["System.ChangedDate"]).getTime() >= t.getTime() - r.stale * day) return false;
      const text = (String(f["System.Title"] || "") + " " + String(f["System.Description"] || "").replace(/<[^>]+>/g, " ")).toLowerCase();
      if (r.words.some(g => !g.all.some(x => text.includes(askStem(x).toLowerCase())))) return false;
      return true;
    };
    return {ids: items.filter(ok).map(it => it.id), titleOnly: false};
  },

  /* ---------- the chat message ---------- */
  async show(text, c) {
    const el = addMsg("bot ask", "");
    const draw = async () => {
      const r = await this.resolve(c);
      el.innerHTML = "";
      const head = document.createElement("div"); head.className = "ask-head"; head.innerHTML = "<b>הבנתי ש:</b>";
      const box = document.createElement("div"); box.className = "ask-chips";
      this.chips(r).forEach(ch => {
        const s = document.createElement("span"); s.className = "ask-chip"; s.textContent = ch.label;
        const x = document.createElement("button"); x.type = "button"; x.textContent = "✕"; x.setAttribute("aria-label", "הסרה: " + ch.label);
        x.onclick = () => { this.drop(c, ch.k); draw(); };
        s.appendChild(x); box.appendChild(s);
      });
      // guiding questions: pick one option to go on
      const qs = document.createElement("div"); qs.className = "ask-qs";
      for (const q of c.ask || []) {
        const box2 = document.createElement("div"); box2.className = "ask-q";
        const title = document.createElement("div");
        title.innerHTML = q.k === "type" ? "<b>למה הכוונה ב\"" + escHtml(q.word) + "\"?</b>" : "<b>לאיזה סקוואד הכוונה ב\"" + escHtml(q.word) + "\"?</b>";
        const opts = document.createElement("div"); opts.className = "ask-opts";
        const choose = fn => { fn(); c.ask = c.ask.filter(x => x !== q); draw(); };
        if (q.k === "type") {
          [["Feature", "Feature"], ["User Story", "User Story"], ["Task", "Task"], ["all", "הכל (כל הסוגים)"]].forEach(([v, l]) => {
            const b = document.createElement("button"); b.type = "button"; b.className = "btn ghost mini"; b.textContent = l;
            b.onclick = () => choose(() => { if (v !== "all" && !c.types.includes(v)) c.types.push(v); });
            opts.appendChild(b);
          });
        } else {
          const sel = document.createElement("select"); sel.setAttribute("aria-label", "בחירת סקוואד");
          sel.add(new Option("בחרו סקוואד", ""));
          (await this.squadNames()).forEach(s => sel.add(new Option(s, s)));
          sel.onchange = () => { if (!sel.value) return; const v = sel.value; choose(() => { if (!c.squads.includes(v)) c.squads.push(v); c.learned = (c.learned || []).concat([[q.word, v]]); }); };
          const skip = document.createElement("button"); skip.type = "button"; skip.className = "btn ghost mini"; skip.textContent = "בלי סינון סקוואד";
          skip.onclick = () => choose(() => {});
          opts.append(sel, skip);
        }
        box2.append(title, opts); qs.appendChild(box2);
      }
      const bar = document.createElement("div"); bar.className = "ask-bar";
      const run = document.createElement("button"); run.type = "button"; run.className = "btn"; run.textContent = "הרצה";
      run.onclick = () => this.run(r, el, run);
      if ((c.ask || []).length) { run.disabled = true; run.title = "קודם עונים על השאלה למעלה"; }
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn ghost"; edit.textContent = "ניסוח מחדש";
      edit.onclick = () => { $("input").value = text; $("input").focus(); };
      bar.append(run, edit);
      // a name the user taught by choosing: offer to add it to the dictionary for everyone
      (c.learned || []).forEach(([w, s]) => {
        const req = document.createElement("button"); req.type = "button"; req.className = "btn ghost"; req.textContent = "בקשה להוסיף \"" + w + "\" = " + s + " למילון";
        req.onclick = () => this.requestSynonym([w + " = Squad " + s]);
        bar.appendChild(req);
      });
      if (r.words.length) {
        const req = document.createElement("button"); req.type = "button"; req.className = "btn ghost"; req.textContent = "בקשה להוסיף מילה נרדפת";
        req.title = "שליחת בקשה למנהלי אז'ורי להוסיף מילים נרדפות למילון";
        req.onclick = () => this.requestSynonym(r.words.map(w => w.word));
        bar.appendChild(req);
      }
      const hint = document.createElement("div"); hint.className = "muted ask-hint";
      hint.textContent = "לחצו ✕ כדי להסיר משהו שלא התכוונתם אליו. ברירת המחדל: פריטים פתוחים ב-PI הנוכחי. עד " + ASK_MAX + " תוצאות.";
      el.append(qs, head, box, bar, hint);
      scrollDown();
    };
    await draw();
    return el;
  },

  async run(r, el, btn) {
    if (busy) return;
    busy = true; $("sendBtn").disabled = true; btn.disabled = true; btn.textContent = "מחפש...";
    try {
      const {ids, titleOnly} = await this.ids(r);
      const more = ids.length > ASK_MAX, use = ids.slice(0, ASK_MAX);
      const note = document.createElement("div"); note.className = "notes";
      note.textContent = !ids.length ? "לא נמצאו פריטים. נסו להסיר סינון (✕) או לנסח אחרת." :
        (more ? "נמצאו יותר מ-" + ASK_MAX + " פריטים. מוצגים " + ASK_MAX + " האחרונים שעודכנו, כדאי לצמצם את השאלה." : "נמצאו " + ids.length + " פריטים.") +
        (titleOnly ? " החיפוש בתיאור לא זמין ב-Azure, ולכן חיפשנו מילים בכותרת בלבד." : "");
      el.appendChild(note);
      if (use.length) {
        const items = await fetchItems(use);
        People.fromItems(items);
        const fields = getDefaultFields();
        try { await loadParents(fields, items); } catch (e) {}
        renderResult(buildTable(fields, items, use.filter(id => items.some(it => it.id === id))), {fields, ask: true}, null, items);
      }
    } catch (e) {
      addMsg("bot error", escHtml(e.message || String(e)));
      if (e instanceof AuthError && Auth.mode === "pat") { await Auth.logout(); setTimeout(() => showLogin(e.message), 1500); }
    } finally { busy = false; $("sendBtn").disabled = false; btn.disabled = false; btn.textContent = "הרצה"; }
  },

  /* a request to the admins (mail): users cannot save team settings */
  requestSynonym(words) {
    const admins = normalizePermissions(TeamConfig.data.permissions).users.filter(u => u.role === "admin").map(u => u.email);
    const subject = "אז'ורי: בקשה להוסיף מילים נרדפות למילון";
    const body = "שלום,\r\n\r\nאשמח שתוסיפו למילון של אז'ורי מילים נרדפות ל: " + words.join(", ") + "\r\nמילים נרדפות: \r\n\r\nתודה, " + (Auth.userName || "");
    openMailto("mailto:" + encodeURIComponent(admins.join(",")).replace(/%40/g, "@").replace(/%2C/g, ",") + "?subject=" + encodeURIComponent(subject) + "&body=" + encodeURIComponent(body));
    toast(admins.length ? "נפתח מייל למנהלי אז'ורי" : "אין מנהלים בטבלת ההרשאות. כתבו למי שמנהל את אז'ורי");
  }
};
