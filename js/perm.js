"use strict";
/* ============================================================
   Update permissions: who may change which work items in Azuri.

   A person may change (and create) an item when at least one of these matches:
     - the item's Area Path is one of their Azure team's areas (or below it)
     - the item's Leading Squad is one of their squads
   Their areas and squads come from two places, combined:
     1. Azure DevOps: the teams they belong to (team areas; a team whose name is a squad gives that squad)
     2. The exceptions table in the team settings (team-config.json → permissions.users),
        by email: extra squads / areas, "admin" (everything) or "readonly" (nothing).

   This is a guard inside Azuri only. Azure DevOps itself still allows whatever the token allows.
   ============================================================ */

const PERM_SQUAD = "Custom.LeadingSquad";
const PERM_AREA = "System.AreaPath";

function normalizePermissions(p) {
  const out = {mode: "block", users: []};
  if (p && typeof p === "object") {
    if (p.mode === "off") out.mode = "off";
    const list = (v, low) => (Array.isArray(v) ? v : String(v || "").split(/[\n,;]/)).map(x => String(x || "").trim()).filter(Boolean).map(x => low ? x.toLowerCase() : x);
    (Array.isArray(p.users) ? p.users : []).forEach(u => {
      const email = String((u && u.email) || "").trim().toLowerCase();
      if (!email) return;
      const role = ["admin", "readonly"].includes(u.role) ? u.role : "user";
      out.users.push({email, name: String(u.name || "").trim(), role, squads: list(u.squads), areas: list(u.areas), note: String(u.note || "").trim()});
    });
  }
  return out;
}

const Perm = {
  state: null,          // {teams:[{name, areas:[{path, children}], squads:[]}], areas, squads, role, row, error, email}
  _p: null,

  cfg() { return normalizePermissions(TeamConfig.data && TeamConfig.data.permissions); },
  me() { return String(Auth.userEmail || "").trim().toLowerCase(); },
  key(s) { return String(s || "").trim().toLowerCase().replace(/\s+/g, " "); },

  reset() { this.state = null; this._p = null; },
  ready() { if (!this._p) this._p = this.load(); return this._p; },

  async load() {
    const st = {teams: [], areas: [], squads: [], role: "user", row: null, error: "", email: this.me()};
    try { st.teams = Auth.mode === "demo" ? this.demoTeams() : await this.azureTeams(); }
    catch (e) { st.error = (e && e.message) || String(e); }
    let squadNames = [];
    try { const m = await Meta.typeMeta("User Story"); const f = m.byRef.get(PERM_SQUAD); squadNames = (f && f.allowed) || []; } catch (e) {}
    st.teams.forEach(t => {
      t.areas.forEach(a => st.areas.push(a));
      t.squads.forEach(s => st.squads.push(s));
      // a team named like a squad ("Meteor", "Meteor Team", "Meteor - Dev") gives that squad
      squadNames.forEach(s => { const k = this.key(s), n = this.key(t.name); if (n === k || n.startsWith(k + " ") || n.startsWith(k + "-") || n.startsWith(k + "_")) { st.squads.push(s); t.squads.push(s); } });
    });
    // a person can have several rows (one per Area Path): all of them count
    const rows = this.cfg().users.filter(u => u.email === st.email);
    if (rows.length) {
      st.row = rows[0];
      // admin anywhere wins; otherwise "read only" in any row wins (the safer reading)
      st.role = rows.some(r => r.role === "admin") ? "admin" : rows.some(r => r.role === "readonly") ? "readonly" : "user";
      rows.forEach(r => {
        r.squads.forEach(s => st.squads.push(s));
        r.areas.forEach(a => st.areas.push({path: a, children: true}));
      });
    }
    st.squads = [...new Set(st.squads)];
    this.state = st;
    return st;
  },

  /* Azure: my teams in this project, and the area paths each team owns. */
  async azureTeams() {
    const project = (TeamConfig.data && TeamConfig.data.project) || "";
    let d;
    try { d = await api(ADO + "/_apis/teams?$mine=true&$top=200&api-version=7.1-preview.3"); }
    catch (e) {
      // work items work with this token, so a refusal here means the token cannot read teams
      if (e instanceof AuthError || /N2|דחה את הטוקן|הרשאה/.test(e.message || "")) throw new Error("לטוקן אין הרשאה לקרוא צוותים. צרו טוקן עם Work Items: Read & write וגם Project and Team: Read");
      throw e;
    }
    const teams = (d.value || []).filter(t => !project || this.key(t.projectName) === this.key(project));
    return Promise.all(teams.map(async t => {
      const out = {name: t.name, areas: [], squads: []};
      try {
        const v = await api(ADO + "/" + encodeURIComponent(t.projectName || project) + "/" + encodeURIComponent(t.name) + "/_apis/work/teamsettings/teamfieldvalues?api-version=7.1");
        const field = (v.field && v.field.referenceName) || PERM_AREA;
        (v.values || []).forEach(x => {
          if (field === PERM_AREA) out.areas.push({path: x.value, children: !!x.includeChildren});
          else if (field === PERM_SQUAD) out.squads.push(x.value);
        });
      } catch (e) { out.error = e.message || String(e); }
      return out;
    }));
  },
  demoTeams() {
    return [{name: "Meteor", areas: [{path: "Portfolio Merkava\\MK2\\Meteor", children: true}], squads: []}];
  },

  areaOk(path) {
    const p = this.key(path).replace(/\\+$/, "");
    if (!p) return false;
    return this.state.areas.some(a => {
      const k = this.key(a.path).replace(/\\+$/, "");
      return p === k || (a.children && p.startsWith(k + "\\"));
    });
  },
  squadOk(squad) {
    const s = this.key(squad);
    return !!s && this.state.squads.some(x => this.key(x) === s);
  },

  /* fields: the item's fields (System.AreaPath, Custom.LeadingSquad). Returns {ok, why}. */
  allows(fields) {
    if (this.cfg().mode === "off") return {ok: true};
    const st = this.state;
    if (!st) return {ok: false, why: "ההרשאות עדיין נטענות. נסו שוב בעוד רגע."};
    if (st.role === "admin") return {ok: true};
    if (st.role === "readonly") return {ok: false, why: "בטבלת ההרשאות אתם מוגדרים לקריאה בלבד."};
    const area = fields && fields[PERM_AREA], squad = fields && fields[PERM_SQUAD];
    if (this.areaOk(area) || this.squadOk(squad)) return {ok: true};
    if (!st.areas.length && !st.squads.length) {
      return {ok: false, why: st.error ? "לא הצלחנו לברר מ-Azure לאילו צוותים אתם שייכים (" + st.error + "). פנו למנהל ההרשאות שיוסיף אתכם לטבלת ההרשאות."
                                       : "לא מצאנו צוות Azure או סקוואד שלכם. פנו למנהל ההרשאות שיוסיף אתכם לטבלת ההרשאות."};
    }
    const owner = [squad ? "Squad " + squad : "", area ? "Area " + area : ""].filter(Boolean).join(", ");
    return {ok: false, why: "אין לכם הרשאה לעדכן פריט של סקוואד אחר" + (owner ? " (" + owner + ")" : "") + ". אפשר לעדכן רק פריטים של הסקוואדים שלכם: " + this.summary() + "."};
  },
  /* An update needs permission on the item as it is and as it will be (no moving items to other squads). */
  check(item, changes) {
    const now = item.fields || {};
    const after = Object.assign({}, now, changes || {});
    if (item.id) { const a = this.allows(now); if (!a.ok) return a; }
    return this.allows(after);
  },

  summary() {
    const st = this.state; if (!st) return "";
    if (st.role === "admin") return "מנהל הרשאות: כל הפריטים";
    if (st.role === "readonly") return "קריאה בלבד";
    const sq = st.squads.join(", "), ar = [...new Set(st.areas.map(a => a.path.split("\\").pop()))].join(", ");
    return [sq ? "Squad: " + sq : "", ar ? "Area: " + ar : ""].filter(Boolean).join(" · ") || "אין";
  },

  /* Settings can be saved only by admins, once at least one admin is listed. */
  canSaveSettings() {
    const admins = this.cfg().users.filter(u => u.role === "admin");
    return !admins.length || admins.some(u => u.email === this.me());
  }
};

/* ============================================================
   Areas of a squad: where the squad's work items actually live.
   Looks at items with that Leading Squad changed in the last 180 days and keeps the
   Area Paths that hold at least 5% of them (most used first). Suggestions only.
   ============================================================ */
const SquadAreas = {
  cache: new Map(),
  MIN_SHARE: 0.05, DAYS: 180,
  get(squad) {
    const k = String(squad || "").trim();
    if (!k) return Promise.resolve([]);
    if (!this.cache.has(k)) this.cache.set(k, this.load(k).catch(e => { this.cache.delete(k); throw e; }));
    return this.cache.get(k);
  },
  /* several squads: their areas together, without repeats */
  async many(squads) {
    const lists = await Promise.all((squads || []).map(s => this.get(s).catch(() => [])));
    const seen = new Map();
    lists.flat().forEach(a => { const x = seen.get(a.path); if (x) x.count += a.count; else seen.set(a.path, Object.assign({}, a)); });
    return [...seen.values()].sort((a, b) => b.count - a.count);
  },
  async load(squad) {
    if (Auth.mode === "demo") {
      const demo = {Meteor: [{path: "Portfolio Merkava\\MK2\\Meteor\\Meteor Sigma", count: 40}, {path: "Portfolio Merkava\\MK2\\Meteor\\Meteor Alpha", count: 6}], Payroll: [{path: "Portfolio Merkava\\Payroll", count: 12}]};
      return demo[squad] || [];
    }
    const proj = encodeURIComponent(TeamConfig.data.project);
    const q = "SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [" + PERM_SQUAD + "] = '" + String(squad).replace(/'/g, "''") +
      "' AND [System.ChangedDate] >= @today - " + this.DAYS + " ORDER BY [System.ChangedDate] DESC";
    const w = await apiSend("POST", ADO + "/" + proj + "/_apis/wit/wiql?$top=1000&api-version=7.1", {query: q}, "application/json");
    const ids = (w.workItems || []).map(x => x.id);
    const count = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      const d = await api(ADO + "/_apis/wit/workitems?ids=" + ids.slice(i, i + 200).join(",") + "&fields=System.AreaPath&errorPolicy=omit&api-version=7.1");
      (d.value || []).forEach(it => { const p = it && it.fields && it.fields["System.AreaPath"]; if (p) count.set(p, (count.get(p) || 0) + 1); });
    }
    const total = [...count.values()].reduce((a, b) => a + b, 0);
    return [...count.entries()].map(([path, n]) => ({path, count: n})).filter(a => total && a.count / total >= this.MIN_SHARE)
      .sort((a, b) => b.count - a.count).slice(0, 15);
  }
};
