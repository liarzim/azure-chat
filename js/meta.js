"use strict";
/* ============================================================
   Azure DevOps metadata: work item types, their fields, allowed
   values and the form layout (labels and groups as users see them).
   Shared by the team settings screen and by editing.
   ============================================================ */

// Fields that exist on every type but users never fill in themselves.
const META_SYSTEM_REFS = /^(System\.(Id|Rev|IterationId|AreaId|IterationLevel\d|AreaLevel\d|NodeName|TeamProject|ChangedBy|ChangedDate|CreatedBy|CreatedDate|AuthorizedAs|AuthorizedDate|RevisedDate|Watermark|PersonId|WorkItemType|History|BoardColumn|BoardColumnDone|BoardLane|CommentCount|ExternalLinkCount|HyperLinkCount|AttachedFileCount|RelatedLinkCount|RemoteLinkCount|Parent)|Microsoft\.VSTS\.Common\.(StateChangeDate|ActivatedDate|ActivatedBy|ResolvedDate|ResolvedBy|ClosedDate|ClosedBy|StackRank|BacklogPriority)|Microsoft\.VSTS\.Build\.(IntegrationBuild|FoundIn))$/;
// Form controls that are not fields.
const META_SKIP_CONTROLS = /^(System\.History|Links|Attachments|Related Work|Deployments|Development)$/;
const META_HEADER_ORDER = ["System.Title", "System.AssignedTo", "System.State", "System.Reason", "System.AreaPath", "System.IterationPath"];

const Meta = {
  _cache: new Map(),
  reset() { this._cache.clear(); },

  _once(key, fn) {
    if (!this._cache.has(key)) {
      const p = fn();
      p.catch(() => this._cache.delete(key));
      this._cache.set(key, p);
    }
    return this._cache.get(key);
  },

  projectUrl() { return ADO + "/" + encodeURIComponent(TeamConfig.data.project); },

  /* Real API, or the bundled demo copy in demo mode. */
  async get(url) {
    if (Auth.mode !== "demo") return api(url);
    if (!this._demo) this._demo = fetch("demo/meta.json").then(r => r.json());
    const d = await this._demo;
    let m;
    if (/\/_apis\/wit\/fields\?/.test(url)) return {value: d.fields};
    if (/\/classificationnodes\?/.test(url)) return {value: d.classificationnodes || []};
    if ((m = url.match(/\/workitemtypes\/([^/?]+)\/fields\?/))) return {value: d.typeFields[decodeURIComponent(m[1])] || []};
    if ((m = url.match(/\/workitemtypes\/([^/?]+)\/states\?/))) { const w = d.workitemtypes.find(x => x.name === decodeURIComponent(m[1])); return {value: w ? w.states || [] : []}; }
    if (/\/_apis\/wit\/workitemtypes\?/.test(url)) return {value: d.workitemtypes};
    if (/\/_apis\/work\/processes\/[^/]+\/workitemtypes\?/.test(url)) return {value: d.processWits};
    if ((m = url.match(/\/workItemTypes\/([^/?]+)\/layout\?/))) { const w = d.processWits.find(x => x.referenceName === m[1]); return w ? d.layouts[w.name] : null; }
    throw new Error("demo: unknown " + url);
  },

  fieldDefs() {
    return this._once("fields", async () => {
      const d = await this.get(ADO + "/_apis/wit/fields?api-version=7.1");
      return new Map((d.value || []).map(f => [f.referenceName, f]));
    });
  },

  workItemTypes() {
    return this._once("wits", async () => {
      const d = await this.get(this.projectUrl() + "/_apis/wit/workitemtypes?api-version=7.1");
      return (d.value || []).filter(w => !w.isDisabled);
    });
  },

  /* States of one type (small call; the full type list carries every form's XML). */
  typeStates(type) {
    return this._once("states:" + type, async () => {
      try {
        const d = await this.get(this.projectUrl() + "/_apis/wit/workitemtypes/" + encodeURIComponent(type) + "/states?api-version=7.1");
        return d.value || [];
      } catch (e) {
        const w = (await this.workItemTypes()).find(x => x.name === type) || {};
        return w.states || [];
      }
    });
  },

  /* Warm the cache in the background after sign-in, so the first form opens fast. */
  prefetch(types) {
    const run = () => (types || []).reduce((p, t) => p.then(() => this.typeMeta(t).catch(() => {})), Promise.resolve());
    setTimeout(run, 300);
  },

  processTypes() {
    return this._once("pwits", async () => {
      const d = await this.get(ADO + "/_apis/work/processes/" + TeamConfig.data.processId + "/workitemtypes?api-version=7.1");
      return d.value || [];
    });
  },

  typeFields(type) {
    return this._once("tf:" + type, async () => {
      const d = await this.get(this.projectUrl() + "/_apis/wit/workitemtypes/" + encodeURIComponent(type) + "/fields?$expand=allowedValues&api-version=7.1");
      return d.value || [];
    });
  },

  layout(type) {
    return this._once("layout:" + type, async () => {
      const pw = await this.processTypes();
      const w = pw.find(x => x.name === type);
      if (!w) return null;
      return this.get(ADO + "/_apis/work/processes/" + TeamConfig.data.processId + "/workItemTypes/" + w.referenceName + "/layout?api-version=7.1");
    });
  },

  /* Everything about one type, shaped for the UI:
     {type, states:[{name,category}], groups:[{key,label,fields:[F]}], byRef:Map}
     F = {ref, label, name, type, azureRequired, allowed, defaultValue, isIdentity, onForm} */
  typeMeta(type) {
    return this._once("meta:" + type, async () => {
      const [defs, states, tfs] = await Promise.all([this.fieldDefs(), this.typeStates(type), this.typeFields(type)]);
      let lay = null;
      try { lay = await this.layout(type); } catch (e) { lay = null; }   // layout needs extra rights; fields still work without it
      const byRef = new Map();
      tfs.forEach(tf => {
        const d = defs.get(tf.referenceName) || {};
        if (d.readOnly || META_SYSTEM_REFS.test(tf.referenceName) || /^WEF_/.test(tf.referenceName)) return;
        byRef.set(tf.referenceName, {
          ref: tf.referenceName, name: tf.name || d.name || tf.referenceName, label: tf.name || d.name || tf.referenceName,
          type: d.type || "string", isIdentity: !!d.isIdentity,
          azureRequired: !!tf.alwaysRequired,
          allowed: (tf.allowedValues || []).filter(v => v !== "<None>"),
          defaultValue: (tf.defaultValue && typeof tf.defaultValue === "object") ? null : tf.defaultValue,
          onForm: false
        });
      });
      const groups = [];
      const used = new Set();
      const take = (ref, label) => {
        const f = byRef.get(ref);
        if (!f || used.has(ref)) return null;
        used.add(ref); f.onForm = true;
        if (label) f.label = String(label).replace(/&/g, "").trim() || f.label;
        return f;
      };
      // Header of the form (title, assigned to, state, area, iteration)
      const header = [];
      const sys = lay && lay.systemControls ? lay.systemControls : [];
      META_HEADER_ORDER.forEach(ref => {
        const c = sys.find(x => x.id === ref);
        if (c && c.visible === false) return;
        const f = take(ref, c && c.label); if (f) header.push(f);
      });
      if (header.length) groups.push({key: "header", label: "כותרת הטופס", fields: header});
      (lay && lay.pages || []).forEach(pg => {
        if (pg.visible === false) return;
        (pg.sections || []).forEach(sec => (sec.groups || []).forEach(g => {
          if (g.visible === false) return;
          const fs = [];
          (g.controls || []).forEach(c => {
            if (c.visible === false || c.isContribution || META_SKIP_CONTROLS.test(c.id || "")) return;
            const f = take(c.id, c.label || g.label); if (f) fs.push(f);
          });
          if (fs.length) {
            const label = (pg.label && pg.label !== "Details" ? pg.label + " · " : "") + (g.label || "");
            groups.push({key: "g" + groups.length, label: label || "כללי", fields: fs});
          }
        }));
      });
      const rest = [...byRef.values()].filter(f => !used.has(f.ref)).sort((a, b) => a.label.localeCompare(b.label));
      if (rest.length) groups.push({key: "other", label: "שדות שלא מופיעים בטופס", fields: rest, collapsed: true});
      return {type, states: (states || []).map(s => ({name: s.name, category: s.category, color: s.color})), groups, byRef, hasLayout: !!lay};
    });
  },

  /* Required = required in Azure itself, plus the team's list. */
  async requiredRefs(type) {
    const m = await this.typeMeta(type);
    const set = new Set(TeamConfig.requiredFor(type));
    m.byRef.forEach(f => { if (f.azureRequired) set.add(f.ref); });
    return set;
  }
};
