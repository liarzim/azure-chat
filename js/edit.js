"use strict";
/* ============================================================
   Updating work items.
   - Edit panel opened from the table (click a cell or ✎)
   - Chat commands: "112074 State Resolved", "110047 112074 Iteration 4.2",
     "112074 תגובה: טקסט", several changes separated by ";"
   Every save: preview → confirm → PATCH with a revision check.
   Required fields (Azure + team) and the Feature template are checked
   on the final state of the item before anything is sent.
   ============================================================ */

class ConflictError extends Error {}

/* ---------- People seen in this session (for Assigned To etc.) ---------- */
const People = {
  map: new Map(),          // uniqueName(lower) -> {displayName, uniqueName}
  add(v) {
    if (!v || typeof v !== "object" || !v.uniqueName) return;
    this.map.set(v.uniqueName.toLowerCase(), {displayName: v.displayName || v.uniqueName, uniqueName: v.uniqueName});
  },
  fromItems(items) { (items || []).forEach(it => Object.values(it.fields || {}).forEach(v => this.add(v))); },
  list() { return [...this.map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)); },
  me() { return Auth.userEmail ? {displayName: Auth.userName || Auth.userEmail, uniqueName: Auth.userEmail} : null; },
  async search(q) {
    q = String(q || "").trim(); if (q.length < 2) return [];
    const local = this.list().filter(p => norm(p.displayName + p.uniqueName).includes(norm(q)));
    if (Auth.mode !== "pat") return local;
    try {
      const r = await apiSend("POST", ADO + "/_apis/IdentityPicker/Identities?api-version=7.1-preview.1",
        {query: q, identityTypes: ["user"], operationScopes: ["ims", "source"], options: {MinResults: 5, MaxResults: 20}, properties: ["DisplayName", "Mail", "SignInAddress"]}, "application/json");
      const ids = ((r.results || [])[0] || {}).identities || [];
      ids.forEach(i => { const un = i.signInAddress || i.mail; if (un) this.add({displayName: i.displayName, uniqueName: un}); });
      return this.list().filter(p => norm(p.displayName + p.uniqueName).includes(norm(q)));
    } catch (e) { return local; }
  }
};

/* ---------- Area / Iteration paths ---------- */
Meta.classPaths = function () {
  return this._once("classnodes", async () => {
    const d = await this.get(this.projectUrl() + "/_apis/wit/classificationnodes?$depth=10&api-version=7.1");
    const out = {area: [], iteration: []};
    const walk = (n, base, kind) => { const p = base ? base + "\\" + n.name : n.name; out[kind].push(p); (n.children || []).forEach(c => walk(c, p, kind)); };
    (d.value || []).forEach(root => walk(root, "", String(root.structureType).toLowerCase() === "iteration" ? "iteration" : "area"));
    return out;
  });
};

/* ---------- Generic write call ---------- */
async function apiSend(method, url, body, contentType) {
  if (Auth.mode === "demo") throw new Error("demo");
  let r;
  try {
    r = await fetch(url, {method, credentials: "omit", headers: {Authorization: await Auth.header(), "Content-Type": contentType || "application/json-patch+json", Accept: "application/json"}, body: JSON.stringify(body)});
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new Error("אין חיבור ל-Azure DevOps. בדקו את חיבור הרשת או ה-VPN.");
  }
  const ct = r.headers.get("content-type") || "";
  if (r.status === 401 || r.status === 203 || (r.ok && !ct.includes("json"))) throw new AuthError("הטוקן לא תקין, פג תוקפו, או שאין לו הרשאת Work Items: Read & Write.");
  let data = null; try { data = await r.json(); } catch (e) {}
  const msg = (data && (data.message || (data.value && data.value.Message))) || "";
  if (r.status === 412 || r.status === 409 || /TF26071|changed by someone else|test operation/i.test(msg)) throw new ConflictError("הפריט עודכן בינתיים על ידי מישהו אחר. שלפו אותו מחדש ונסו שוב.");
  if (r.status === 403) throw new Error("אין לכם הרשאה לעדכן את הפריט הזה" + (msg ? ": " + msg : "."));
  if (!r.ok) throw new Error(msg ? cleanAzureMessage(msg) : "Azure DevOps החזיר שגיאה " + r.status);
  return data;
}
function cleanAzureMessage(m) { return String(m).replace(/^TF\d+:\s*/, "").slice(0, 400); }

/* ---------- Values ---------- */
const EMPTY_WORDS = new Set(["ריק", "ללא", "none", "empty", "null", "-", "—", "נקה"]);
function isEmptyValue(f, v) {
  if (v === undefined || v === null) return true;
  if (typeof v === "boolean" || typeof v === "number") return false;
  if (typeof v === "object") return !(v.uniqueName || v.displayName);
  if (f && f.type === "html") return !cleanHtml(String(v)).replace(/[\s ]/g, "") && !/<img/i.test(String(v));
  return !String(v).trim();
}
function identityText(v) {
  if (!v) return "";
  if (typeof v === "object") return v.displayName || v.uniqueName || "";
  const m = String(v).match(/^(.*?)\s*<([^>]+)>\s*$/); return m ? m[1] : String(v);
}
function displayValue(f, v) {
  if (isEmptyValue(f, v)) return "—";
  if (f.isIdentity || (typeof v === "object" && v && v.displayName)) return identityText(v);
  if (f.type === "html") { const t = cleanHtml(String(v)).replace(/\n/g, " • "); return t.length > 140 ? t.slice(0, 140) + "…" : t || "[תמונה]"; }
  if (f.type === "dateTime") return fmtDate(v);
  if (f.type === "boolean") return (v === true || v === "true" || v === 1 || v === "1") ? "כן" : "לא";
  return String(v);
}
/* Same HTML regardless of attribute order or serialization details. */
function canonHtml(h) {
  const d = document.createElement("div"); d.innerHTML = String(h || "");
  d.querySelectorAll("*").forEach(el => {
    const attrs = [...el.attributes].map(x => [x.name, x.value]).sort((p, q) => p[0].localeCompare(q[0]));
    attrs.forEach(([n]) => el.removeAttribute(n)); attrs.forEach(([n, v]) => el.setAttribute(n, v));
  });
  return d.innerHTML.replace(/\s*style="direction:\s*rtl;?"/g, "").replace(/direction:\s*rtl;?\s*/g, "").replace(/\s+/g, " ").trim();
}
function sameValue(f, a, b) {
  if (isEmptyValue(f, a) && isEmptyValue(f, b)) return true;
  if (f.type === "html") return canonHtml(a) === canonHtml(b);
  if (f.isIdentity) return norm(identityUnique(a)) === norm(identityUnique(b));
  if (f.type === "dateTime") return String(a).slice(0, 10) === String(b).slice(0, 10);
  if (f.type === "boolean") return displayValue(f, a) === displayValue(f, b);
  return String(a) === String(b);
}
function identityUnique(v) {
  if (!v) return "";
  if (typeof v === "object") return v.uniqueName || v.displayName || "";
  const m = String(v).match(/<([^>]+)>/); return m ? m[1] : String(v);
}
function identityValue(p) { return p.uniqueName && p.displayName && p.uniqueName !== p.displayName ? p.displayName + " <" + p.uniqueName + ">" : (p.uniqueName || p.displayName); }

function pickOne(raw, options, label) {
  const r = String(raw).trim(), q = norm(r);
  const exact = options.filter(o => norm(o) === q);
  if (exact.length) return {value: exact[0]};
  const starts = options.filter(o => norm(o).startsWith(q));
  if (starts.length === 1) return {value: starts[0]};
  const has = options.filter(o => norm(o).includes(q));
  if (has.length === 1) return {value: has[0]};
  const opts = (starts.length ? starts : has.length ? has : options).slice(0, 12);
  return {error: (starts.length || has.length ? "יש כמה אפשרויות ל-" : "אין ערך כזה ב-") + label + ': "' + r + '"', options: opts};
}
function parseDate(raw) {
  const s = String(raw).trim();
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return y + "-" + pad(m[2]) + "-" + pad(m[1]) + "T00:00:00Z"; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + "-" + m[2] + "-" + m[3] + "T00:00:00Z";
  return null;
}

/* Raw text (from chat) → API value for one field of one item. */
async function resolveValue(f, raw, meta, item) {
  const r = String(raw).trim();
  if (EMPTY_WORDS.has(norm(r))) {
    if (f.azureRequired) return {error: f.label + " הוא שדה חובה ב-Azure ואי אפשר לרוקן אותו."};
    return {value: null};
  }
  if (f.ref === "System.State") return pickOne(r, meta.states.map(s => s.name), "State");
  if (f.ref === "System.AreaPath" || f.ref === "System.IterationPath") {
    const paths = (await Meta.classPaths())[f.ref === "System.AreaPath" ? "area" : "iteration"];
    const q = norm(r);
    const full = paths.filter(p => norm(p) === q);
    if (full.length) return {value: full[0]};
    const tail = paths.filter(p => norm(p.split("\\").pop()) === q || norm(p).endsWith(norm("\\" + r)));
    if (tail.length === 1) return {value: tail[0]};
    return {error: (tail.length ? "יש כמה נתיבים מתאימים ל-" : "לא נמצא נתיב ל-") + f.label + ': "' + r + '"', options: (tail.length ? tail : paths.filter(p => norm(p).includes(q))).slice(0, 12)};
  }
  if (f.isIdentity) {
    if (["אני", "me", "לי", "אליי"].includes(norm(r))) {
      const me = People.me();
      if (me) return {value: identityValue(me)};
      if (Auth.userName) { const f2 = (await People.search(Auth.userName)).filter(p => norm(p.displayName) === norm(Auth.userName)); if (f2.length === 1) return {value: identityValue(f2[0])}; }
      return {error: "לא ידוע מי המשתמש המחובר. כתבו את השם או האימייל במקום \"אני\"."};
    }
    if (/@/.test(r) && !/\s/.test(r)) return {value: r};
    const found = await People.search(r);
    if (found.length === 1) return {value: identityValue(found[0])};
    const exact = found.filter(p => norm(p.displayName) === norm(r));
    if (exact.length === 1) return {value: identityValue(exact[0])};
    return {error: (found.length ? "יש כמה אנשים שמתאימים ל-" : "לא נמצא אדם בשם ") + '"' + r + '"', options: found.slice(0, 12).map(p => p.displayName + " <" + p.uniqueName + ">")};
  }
  if (f.allowed && f.allowed.length) return pickOne(r, f.allowed, f.label);
  if (f.type === "boolean") {
    if (["כן", "yes", "true", "1", "v", "✓"].includes(norm(r))) return {value: true};
    if (["לא", "no", "false", "0"].includes(norm(r))) return {value: false};
    return {error: f.label + " מקבל רק כן או לא."};
  }
  if (f.type === "integer") { const n = parseInt(r, 10); return isNaN(n) ? {error: f.label + " צריך להיות מספר שלם."} : {value: n}; }
  if (f.type === "double") { const n = parseFloat(r.replace(",", ".")); return isNaN(n) ? {error: f.label + " צריך להיות מספר."} : {value: n}; }
  if (f.type === "dateTime") { const d = parseDate(r); return d ? {value: d} : {error: f.label + " צריך להיות תאריך, למשל 15/10/2026."}; }
  if (f.ref === "System.Tags") {
    const cur = String((item && item.fields && item.fields["System.Tags"]) || "").split(";").map(s => s.trim()).filter(Boolean);
    const parts = r.split(/[;,]/).map(s => s.trim()).filter(Boolean);
    if (parts.every(p => /^[+-]/.test(p))) {
      let tags = cur.slice();
      parts.forEach(p => { const t = p.slice(1).trim(); if (p[0] === "+") { if (!tags.some(x => norm(x) === norm(t))) tags.push(t); } else tags = tags.filter(x => norm(x) !== norm(t)); });
      return {value: tags.join("; ") || null};
    }
    return {value: parts.join("; ")};
  }
  if (f.type === "html") return {value: r.split("\n").map(l => '<div style="direction:rtl;">' + (escHtml(l) || "<br>") + "</div>").join("")};
  return {value: r};
}

/* ---------- Planning and saving ---------- */
const Edit = {
  /* changes: {ref: apiValue}. Returns everything needed to preview and save. */
  async plan(item, changes, comment) {
    const type = item.fields["System.WorkItemType"];
    const meta = await Meta.typeMeta(type);
    const required = await Meta.requiredRefs(type);
    const finalVal = ref => Object.prototype.hasOwnProperty.call(changes, ref) ? changes[ref] : item.fields[ref];
    const diffs = [], errors = [];
    Object.entries(changes).forEach(([ref, v]) => {
      const f = meta.byRef.get(ref);
      if (!f) { errors.push("השדה " + ref + " לא קיים או לא ניתן לעריכה ב-" + type); return; }
      if (sameValue(f, item.fields[ref], v)) return;
      if (f.type === "html") {
        const was = isEmptyValue(f, item.fields[ref]), now = isEmptyValue(f, v);
        diffs.push({ref, label: f.label, before: was ? "—" : "תוכן קודם", after: now ? "—" : (was ? "תוכן חדש" : "התוכן עודכן"), f});
      } else diffs.push({ref, label: f.label, before: displayValue(f, item.fields[ref]), after: displayValue(f, v), f});
    });
    const missing = [...required].map(ref => meta.byRef.get(ref)).filter(f => f && isEmptyValue(f, finalVal(f.ref)));
    let template = null;
    const tpl = TeamConfig.template(type);
    if (tpl) {
      const chk = checkTemplate(tpl, finalVal(tpl.field));
      if (chk.applies && (chk.missing.length || chk.empty.length)) template = chk;
    }
    const hasComment = !!(comment && String(comment).trim());
    return {item, type, meta, diffs, errors, missing, template, changes, comment: hasComment ? comment : "",
            ok: !errors.length && !missing.length && !template && (diffs.length > 0 || hasComment)};
  },

  async commit(plan) {
    const item = plan.item;
    if (Auth.mode === "demo") return DemoDB.patch(item.id, item.rev, plan.diffs.map(d => [d.ref, this._val(plan, d.ref)]), plan.comment);
    const ops = [{op: "test", path: "/rev", value: item.rev}];
    plan.diffs.forEach(d => {
      const v = this._val(plan, d.ref);
      if (isEmptyValue(d.f, v)) { if (item.fields[d.ref] !== undefined) ops.push({op: "remove", path: "/fields/" + d.ref}); }
      else ops.push({op: "add", path: "/fields/" + d.ref, value: v});
    });
    if (plan.comment) ops.push({op: "add", path: "/fields/System.History", value: commentHtml(plan.comment)});
    return apiSend("PATCH", ADO + "/_apis/wit/workitems/" + item.id + "?$expand=all&api-version=7.1", ops);
  },
  _val(plan, ref) { return plan.changes[ref]; },

  async fresh(ids) {
    const items = await fetchItems(ids);
    People.fromItems(items);
    return items;
  }
};
function commentHtml(text) { return String(text).split("\n").map(l => '<div style="direction:rtl;">' + (escHtml(l) || "<br>") + "</div>").join(""); }


/* ---------- Refreshing tables after a save ---------- */
const Results = {
  list: [],       // {el, t, req, items}
  add(el, t, req, items) { this.list.push({el, t, req, items}); },
  update(items) {
    const byId = new Map(items.map(i => [i.id, i]));
    this.list = this.list.filter(r => document.body.contains(r.el));
    this.list.forEach(r => {
      if (!r.items.some(i => byId.has(i.id))) return;
      r.items = r.items.map(i => byId.get(i.id) || i);
      const t = buildTable(r.req.fields, r.items, r.t.rows.map(x => x.id));
      r.t = t;
      renderResult(t, r.req, r.el, r.items);
    });
  },
  itemFor(el, rowIndex) { const r = this.list.find(x => x.el === el); return r ? {res: r, item: r.items.find(i => i.id === r.t.rows[rowIndex].id)} : null; }
};

/* ---------- Field editors ---------- */
function makeEditor(f, value, ctx) {
  const wrap = document.createElement("div"); wrap.className = "editor";
  let get, set;
  const onChange = () => ctx && ctx.onChange && ctx.onChange();
  if (f.type === "html") {
    const bar = document.createElement("div"); bar.className = "rtbar";
    const area = document.createElement("div"); area.className = "rich big"; area.contentEditable = "true"; area.setAttribute("aria-label", f.label);
    [["B", "bold", "מודגש"], ["U", "underline", "קו תחתון"], ["•", "insertUnorderedList", "רשימה"], ["1.", "insertOrderedList", "רשימה ממוספרת"]].forEach(([t, cmd, lbl]) => {
      const b = document.createElement("button"); b.type = "button"; b.className = "ib"; b.textContent = t; b.title = lbl; b.setAttribute("aria-label", lbl);
      b.onmousedown = e => e.preventDefault(); b.onclick = () => { document.execCommand(cmd); onChange(); };
      bar.appendChild(b);
    });
    const tpl = ctx && ctx.type ? TeamConfig.template(ctx.type) : null;
    if (tpl && tpl.field === f.ref) {
      const tb = document.createElement("button"); tb.type = "button"; tb.className = "btn ghost sm"; tb.textContent = "הכנסת תבנית";
      tb.onclick = () => {
        if (!isEmptyValue(f, get())) { toast("כבר יש תוכן. התבנית מוכנסת רק לשדה ריק."); return; }
        area.innerHTML = templateHtml(tpl); onChange(); area.focus();
      };
      bar.appendChild(tb);
    }
    // Show Azure-hosted images through authenticated blob URLs, restore the real URL when saving.
    area.innerHTML = String(value || "");
    area.querySelectorAll("img").forEach(img => {
      const src = img.getAttribute("src") || "";
      img.setAttribute("data-orig-src", src); img.removeAttribute("src"); img.classList.add("edimg");
      Img.get(src).then(o => { img.src = o.url; }, () => { img.alt = "[תמונה]"; });
    });
    area.oninput = onChange;
    const tplHere = tpl && tpl.field === f.ref ? tpl : null;
    if (tplHere) {
      const topBlock = n => { while (n && n.parentNode !== area) n = n.parentNode; return n && n.nodeType === 1 ? n : null; };
      // Enter at the end of a heading opens a plain line instead of continuing the heading's formatting.
      area.addEventListener("keydown", e => {
        if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
        const sel = getSelection(); if (!sel.rangeCount) return;
        const blk = topBlock(sel.anchorNode);
        if (!blk || !isHeadingBlock(tplHere, blk)) return;
        e.preventDefault();
        const next = blk.nextElementSibling;
        let line;
        if (next && isBlankBlock(next) && !isHeadingBlock(tplHere, next)) line = next;
        else { line = document.createElement("div"); line.appendChild(document.createElement("br")); blk.after(line); }
        line.innerHTML = "<br>";
        const r = document.createRange(); r.setStart(line, 0); r.collapse(true); sel.removeAllRanges(); sel.addRange(r);
        onChange();
      });
      // Text typed on a content line never keeps the heading look.
      area.addEventListener("input", () => {
        const sel = getSelection(); if (!sel.rangeCount) return;
        const blk = topBlock(sel.anchorNode);
        if (!blk || isHeadingBlock(tplHere, blk) || !hasHeadingLook(tplHere, blk)) return;
        const pre = document.createRange(); pre.selectNodeContents(blk); pre.setEnd(sel.anchorNode, sel.anchorOffset);
        const offset = pre.toString().length;
        stripHeadingLook(tplHere, blk);
        const walker = document.createTreeWalker(blk, NodeFilter.SHOW_TEXT); let left = offset, node, placed = false;
        while ((node = walker.nextNode())) { if (left <= node.length) { const r = document.createRange(); r.setStart(node, left); r.collapse(true); sel.removeAllRanges(); sel.addRange(r); placed = true; break; } left -= node.length; }
        if (!placed) { const r = document.createRange(); r.selectNodeContents(blk); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
      });
    }
    get = () => {
      const c = area.cloneNode(true);
      c.querySelectorAll("img[data-orig-src]").forEach(img => { img.setAttribute("src", img.getAttribute("data-orig-src")); img.removeAttribute("data-orig-src"); img.classList.remove("edimg"); if (!img.className) img.removeAttribute("class"); });
      return tplHere ? normalizeTemplateHtml(tplHere, c.innerHTML) : rtlBlocks(c.innerHTML);
    };
    set = v => { area.innerHTML = v || ""; };
    wrap.append(bar, area);
  } else if (f.ref === "System.State" || (f.allowed && f.allowed.length)) {
    const sel = document.createElement("select"); sel.setAttribute("aria-label", f.label);
    const opts = f.ref === "System.State" ? ctx.meta.states.map(s => s.name) : f.allowed;
    if (!f.azureRequired || isEmptyValue(f, value)) sel.add(new Option("—", ""));
    opts.forEach(o => sel.add(new Option(o, o)));
    if (!isEmptyValue(f, value) && !opts.includes(String(value))) sel.add(new Option(String(value), String(value)));
    sel.value = isEmptyValue(f, value) ? "" : String(value);
    sel.onchange = onChange;
    const num = f.type === "integer" || f.type === "double";
    get = () => sel.value === "" ? null : (num ? Number(sel.value) : sel.value);
    set = v => { sel.value = v == null ? "" : String(v); };
    wrap.appendChild(sel);
  } else if (f.type === "boolean") {
    const sel = document.createElement("select"); sel.setAttribute("aria-label", f.label);
    sel.add(new Option("לא", "false")); sel.add(new Option("כן", "true"));
    sel.value = displayValue(f, value) === "כן" ? "true" : "false";
    sel.onchange = onChange;
    get = () => sel.value === "true"; set = v => { sel.value = v ? "true" : "false"; };
    wrap.appendChild(sel);
  } else if (f.isIdentity) {
    const inp = document.createElement("input"); inp.setAttribute("aria-label", f.label); inp.placeholder = "שם או אימייל";
    const dl = document.createElement("datalist"); dl.id = "dl" + Math.random().toString(36).slice(2); inp.setAttribute("list", dl.id);
    const fill = list => { dl.innerHTML = ""; list.forEach(p => dl.appendChild(new Option(p.displayName + " <" + p.uniqueName + ">", identityValue(p)))); };
    const me = People.me(); fill([...(me ? [me] : []), ...People.list()]);
    inp.value = isEmptyValue(f, value) ? "" : (typeof value === "object" ? identityValue(value) : String(value));
    let t; inp.oninput = () => { onChange(); clearTimeout(t); t = setTimeout(async () => fill(await People.search(inp.value)), 300); };
    get = () => inp.value.trim() || null; set = v => { inp.value = v || ""; };
    wrap.append(inp, dl);
  } else if (f.ref === "System.AreaPath" || f.ref === "System.IterationPath") {
    const inp = document.createElement("input"); inp.setAttribute("aria-label", f.label); inp.dir = "ltr";
    const dl = document.createElement("datalist"); dl.id = "dl" + Math.random().toString(36).slice(2); inp.setAttribute("list", dl.id);
    Meta.classPaths().then(p => (f.ref === "System.AreaPath" ? p.area : p.iteration).forEach(x => dl.appendChild(new Option(x, x))), () => {});
    inp.value = value || ""; inp.oninput = onChange;
    get = () => inp.value.trim() || null; set = v => { inp.value = v || ""; };
    wrap.append(inp, dl);
  } else if (f.type === "dateTime") {
    const inp = document.createElement("input"); inp.type = "date"; inp.setAttribute("aria-label", f.label);
    inp.value = value ? String(value).slice(0, 10) : ""; inp.onchange = onChange;
    get = () => inp.value ? inp.value + "T00:00:00Z" : null; set = v => { inp.value = v ? String(v).slice(0, 10) : ""; };
    wrap.appendChild(inp);
  } else if (f.type === "integer" || f.type === "double") {
    const inp = document.createElement("input"); inp.type = "number"; inp.step = f.type === "integer" ? "1" : "any"; inp.setAttribute("aria-label", f.label);
    inp.value = value == null ? "" : value; inp.oninput = onChange;
    get = () => inp.value === "" ? null : Number(inp.value); set = v => { inp.value = v == null ? "" : v; };
    wrap.appendChild(inp);
  } else {
    const inp = document.createElement("input"); inp.setAttribute("aria-label", f.label);
    inp.value = value == null ? "" : String(value); inp.oninput = onChange;
    get = () => inp.value === "" ? null : inp.value; set = v => { inp.value = v || ""; };
    wrap.appendChild(inp);
  }
  return {el: wrap, get, set, f};
}

/* ---------- Edit panel (from the table) ---------- */
const EditPanel = {
  state: null,

  async open(el, rowIndex, colIndex) {
    const found = Results.itemFor(el, rowIndex);
    if (!found || !found.item) return;
    const item = found.item;
    const type = item.fields["System.WorkItemType"];
    let meta;
    try { meta = await Meta.typeMeta(type); } catch (e) { toast("לא ניתן לטעון את שדות " + type + ": " + e.message); return; }
    const col = colIndex != null ? found.res.t.cols[colIndex] : null;
    let focusRef = null;
    if (col && col.ref) {
      if (col.kind === "desc") focusRef = /bug/i.test(type) && !item.fields["System.Description"] && item.fields["Microsoft.VSTS.TCM.ReproSteps"] ? "Microsoft.VSTS.TCM.ReproSteps" : "System.Description";
      else focusRef = col.ref;
      if (!meta.byRef.has(focusRef)) { toast("השדה " + col.label + " לא ניתן לעריכה"); focusRef = null; }
    }
    this.state = {item, type, meta, editors: new Map(), resEl: el};
    $("editPanel").classList.remove("hidden");
    $("epTitle").textContent = type + " " + item.id;
    $("epSub").textContent = item.fields["System.Title"] || "";
    const link = $("epLink");
    if (Auth.mode === "demo") link.classList.add("hidden");
    else { link.classList.remove("hidden"); link.href = ADO + "/" + encodeURIComponent(item.fields["System.TeamProject"] || TeamConfig.data.project) + "/_workitems/edit/" + item.id; }
    $("epFields").innerHTML = ""; $("epComment").value = "";
    const add = $("epAdd"); add.innerHTML = ""; add.add(new Option("+ הוספת שדה לעריכה", ""));
    meta.groups.forEach(g => {
      const og = document.createElement("optgroup"); og.label = g.label;
      g.fields.forEach(f => og.appendChild(new Option(f.label, f.ref)));
      add.appendChild(og);
    });
    add.onchange = () => { if (add.value) { this.addField(add.value, true); add.value = ""; } };
    if (focusRef) this.addField(focusRef, true);
    await this.refresh();
  },

  addField(ref, focus, reason) {
    const s = this.state; if (!s || s.editors.has(ref)) return;
    const f = s.meta.byRef.get(ref); if (!f) return;
    const row = document.createElement("div"); row.className = "eprow" + (reason ? " needed" : "");
    const lab = document.createElement("label"); lab.textContent = f.label; if (reason) { const r = document.createElement("span"); r.className = "need"; r.textContent = reason; lab.appendChild(r); }
    const ed = makeEditor(f, s.item.fields[ref], {type: s.type, meta: s.meta, onChange: () => this.refresh()});
    const rm = mkIconBtn("✕", "הסרה מהעריכה", false, () => { s.editors.delete(ref); row.remove(); this.refresh(); }, "del");
    const head = document.createElement("div"); head.className = "ephead"; head.append(lab, rm);
    row.append(head, ed.el);
    $("epFields").appendChild(row);
    s.editors.set(ref, {ed, row});
    if (focus) { const x = row.querySelector("input,select,[contenteditable]"); if (x) x.focus(); }
  },

  changes() {
    const s = this.state, ch = {};
    s.editors.forEach(({ed}, ref) => { const v = ed.get(); if (!sameValue(ed.f, s.item.fields[ref], v)) ch[ref] = v; });
    return ch;
  },

  async refresh() {
    const s = this.state; if (!s) return;
    const plan = await Edit.plan(s.item, this.changes(), $("epComment").value);
    s.plan = plan;
    plan.missing.forEach(f => { if (!s.editors.has(f.ref)) this.addField(f.ref, false, "חובה"); });
    s.editors.forEach(({row}, ref) => row.classList.toggle("needed", plan.missing.some(f => f.ref === ref)));
    const box = $("epCheck"); const parts = [];
    if (plan.missing.length) parts.push('<div class="bad">חסרים שדות חובה: ' + plan.missing.map(f => escHtml(f.label)).join(", ") + "</div>");
    if (plan.template) parts.push('<div class="bad">בתבנית של ' + escHtml(s.type) + " חסר תוכן תחת: " + [...plan.template.missing, ...plan.template.empty].map(escHtml).join(", ") + "</div>");
    if (plan.diffs.length) parts.push('<div class="diffs">' + plan.diffs.map(d => '<div><b>' + escHtml(d.label) + ":</b> " + '<span class="before">' + escHtml(d.before) + '</span> ← <span class="after">' + escHtml(d.after) + "</span></div>").join("") + "</div>");
    if (plan.comment) parts.push('<div class="muted">תתווסף תגובה לדיון.</div>');
    if (!plan.diffs.length && !plan.comment) parts.push('<div class="muted">עוד אין שינויים.</div>');
    box.innerHTML = parts.join("");
    $("epSave").disabled = !plan.ok;
    $("epSave").textContent = plan.ok ? "שמירה ב-Azure" : (plan.missing.length || plan.template ? "יש למלא שדות חובה" : "שמירה ב-Azure");
  },

  async save() {
    const s = this.state; if (!s || !s.plan || !s.plan.ok) return;
    const btn = $("epSave"); btn.disabled = true; btn.textContent = "שומר...";
    try {
      const plan = await Edit.plan(s.item, this.changes(), $("epComment").value);
      if (!plan.ok) { await this.refresh(); return; }
      const updated = await Edit.commit(plan);
      People.fromItems([updated]);
      this.close();
      Results.update([updated]);
      addMsg("bot ok", resultLine(plan, true));
    } catch (e) {
      if (e instanceof AuthError) { toast(e.message); }
      $("epCheck").insertAdjacentHTML("afterbegin", '<div class="bad">' + escHtml(e.message || e) + "</div>");
      btn.disabled = false; btn.textContent = "שמירה ב-Azure";
      if (e instanceof ConflictError) { btn.textContent = "שליפה מחדש"; btn.disabled = false; btn.onclick = () => this.reload(); }
    }
  },
  async reload() {
    const s = this.state; if (!s) return;
    const [it] = await Edit.fresh([s.item.id]);
    if (it) { Results.update([it]); s.item = it; this.close(); toast("הפריט נשלף מחדש. פתחו את העריכה שוב."); }
    $("epSave").onclick = () => this.save();
  },
  close() { $("editPanel").classList.add("hidden"); this.state = null; $("epSave").onclick = () => this.save(); },
  init() {
    $("epClose").onclick = () => this.close();
    $("epCancel").onclick = () => this.close();
    $("epSave").onclick = () => this.save();
    $("epComment").oninput = () => this.refresh();
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("editPanel").classList.contains("hidden")) this.close(); });
  }
};

function resultLine(plan, ok, err) {
  const id = plan.item.id;
  const ch = plan.diffs.map(d => escHtml(d.label) + ": " + escHtml(d.before) + " ← " + escHtml(d.after)).join(" · ");
  return (ok ? "✓ עודכן " : "✗ לא עודכן ") + "<b>" + id + "</b>" + (ch ? " · " + ch : "") + (plan.comment ? " · נוספה תגובה" : "") + (err ? ' <span class="bad">' + escHtml(err) + "</span>" : "");
}

/* ---------- Chat commands ---------- */
const ChatEdit = {
  VERBS: /^(עדכן|עדכני|שנה|שני|update|set)\s+/i,
  COMMENT: /^(תגובה|הערה|comment)\s*[:：]\s*/i,
  ASSIGN: /^(שייך|שייכי|הקצה|assign)\s+(ל-?|to\s+)?/i,

  /* Returns {ids, pairs:[{name, raw}], comment} or null when this is a regular lookup. */
  async parse(text) {
    let t = text.trim().replace(this.VERBS, "");
    const m = t.match(/^((?:#?\d{3,}[\s,]*)+)([\s\S]*)$/);
    if (!m) return null;
    const ids = [...new Set((m[1].match(/\d{3,}/g) || []).map(Number))];
    const rest = m[2].trim();
    if (!rest) return null;
    if (/^(רק|תוסיף|הוסף|להוסיף|בלי|ללא|without|only|add)(\s|$)/i.test(rest)) return null;
    const pairs = []; let comment = "";
    const segs = rest.split(/\s*[;\n]\s*/).filter(Boolean);
    for (const seg of segs) {
      if (this.COMMENT.test(seg)) { comment = (comment ? comment + "\n" : "") + seg.replace(this.COMMENT, ""); continue; }
      if (this.ASSIGN.test(seg)) { pairs.push({name: "Assigned To", raw: seg.replace(this.ASSIGN, "")}); continue; }
      const p = await this.splitPair(seg);
      if (!p) return pairs.length || comment ? {ids, pairs, comment, bad: seg} : null;
      pairs.push(p);
    }
    return pairs.length || comment ? {ids, pairs, comment} : null;
  },

  async fieldNames() {
    const names = new Map();
    FIELDS.forEach(f => { if (f.ref && !f.ref.startsWith("__") && f.ref !== "id") { names.set(norm(f.name), f.name); f.aliases.forEach(a => names.set(norm(a), f.name)); } });
    for (const t of TeamConfig.data.types) {
      try { (await Meta.typeMeta(t)).byRef.forEach(f => { names.set(norm(f.label), f.label); names.set(norm(f.name), f.name); names.set(norm(f.ref), f.ref); }); } catch (e) {}
    }
    return names;
  },
  async splitPair(seg) {
    const eq = seg.match(/^([^=:：]+?)\s*[=:：]\s*([\s\S]+)$/);
    const names = await this.fieldNames();
    if (eq && names.has(norm(eq[1]))) return {name: names.get(norm(eq[1])), raw: eq[2]};
    const words = seg.split(/\s+/);
    for (let n = Math.min(5, words.length - 1); n >= 1; n--) {
      const key = norm(words.slice(0, n).join(" "));
      if (names.has(key)) return {name: names.get(key), raw: words.slice(n).join(" ")};
    }
    return null;
  },

  fieldFor(meta, name) {
    const q = norm(name);
    const known = resolveKnown(name);
    for (const f of meta.byRef.values()) if (norm(f.label) === q || norm(f.name) === q || norm(f.ref) === q || (known && known.ref === f.ref)) return f;
    return null;
  },

  async run(cmd) {
    if (cmd.bad) { addMsg("bot error", "לא הבנתי את החלק: " + escHtml(cmd.bad) + '. כתבו שדה וערך, למשל <code>State Active</code> או <code>Priority=2</code>.'); return; }
    const wait = addMsg("bot typing", "מכין עדכון ל-" + cmd.ids.length + " פריטים...");
    let items;
    try { items = await Edit.fresh(cmd.ids); } finally { wait.remove(); }
    const byId = new Map(items.map(i => [i.id, i]));
    const entries = [];
    for (const id of cmd.ids) {
      const item = byId.get(id);
      if (!item) { entries.push({id, error: "לא נמצא או שאין הרשאה"}); continue; }
      const type = item.fields["System.WorkItemType"];
      const meta = await Meta.typeMeta(type);
      const changes = {}, errs = [];
      for (const p of cmd.pairs) {
        const f = this.fieldFor(meta, p.name);
        if (!f) { errs.push("ל-" + type + " אין שדה " + p.name); continue; }
        const r = await resolveValue(f, p.raw, meta, item);
        if (r.error) errs.push(r.error + (r.options && r.options.length ? " (אפשרויות: " + r.options.join(" | ") + ")" : ""));
        else changes[f.ref] = r.value;
      }
      const plan = await Edit.plan(item, changes, cmd.comment);
      plan.errors.push(...errs);
      entries.push({id, item, plan, baseChanges: changes, baseErrors: errs});
    }
    this.renderPreview(entries, cmd);
  },

  renderPreview(entries, cmd) {
    const card = addMsg("bot editcard", "");
    const fills = new Map();   // ref -> {ed, f, ids:Set}
    const head = document.createElement("div"); head.className = "meta";
    head.innerHTML = "<b>עדכון " + entries.length + " פריטים: בדקו ואשרו</b>";
    card.appendChild(head);
    const tbl = document.createElement("table"); tbl.className = "ptable";
    tbl.innerHTML = "<thead><tr><th>ID</th><th>Title</th><th>שינויים</th><th>מצב</th></tr></thead>";
    const tb = document.createElement("tbody"); tbl.appendChild(tb);
    const wrap = document.createElement("div"); wrap.className = "tbl"; wrap.appendChild(tbl); card.appendChild(wrap);
    const fillBox = document.createElement("div"); fillBox.className = "fillbox hidden"; card.appendChild(fillBox);
    const acts = document.createElement("div"); acts.className = "actions pa";
    const ok = document.createElement("button"); ok.className = "btn"; ok.type = "button";
    const cancel = document.createElement("button"); cancel.className = "btn ghost"; cancel.type = "button"; cancel.textContent = "ביטול";
    acts.append(ok, cancel); card.appendChild(acts);

    const recompute = async () => {
      for (const e of entries) {
        if (!e.plan || e.done) continue;
        const ch = Object.assign({}, e.baseChanges);
        fills.forEach((x, ref) => { if (x.ids.has(e.id)) { const v = x.ed.get(); if (!isEmptyValue(x.f, v)) ch[ref] = v; } });
        const p = await Edit.plan(e.item, ch, cmd.comment);
        p.errors.push(...e.baseErrors);
        e.plan = p;
      }
      draw();
    };
    const draw = () => {
      tb.innerHTML = "";
      let ready = 0;
      entries.forEach(e => {
        const tr = document.createElement("tr");
        const p = e.plan;
        let status, cls;
        if (e.error) { status = e.error; cls = "bad"; }
        else if (p.errors.length) { status = p.errors.join(" · "); cls = "bad"; }
        else if (p.missing.length) { status = "חסרים שדות חובה: " + p.missing.map(f => f.label).join(", "); cls = "warn"; }
        else if (p.template) { status = "חסר תוכן בתבנית: " + [...p.template.missing, ...p.template.empty].join(", "); cls = "bad"; }
        else if (!p.diffs.length && !p.comment) { status = "אין שינוי"; cls = "muted"; }
        else { status = e.done ? "✓ עודכן" : "מוכן"; cls = e.done ? "okc" : "okc"; ready += e.done ? 0 : 1; }
        if (e.saveError) { status = "✗ " + e.saveError; cls = "bad"; }
        const changes = p ? p.diffs.map(d => "<div><b>" + escHtml(d.label) + ":</b> <span class=\"before\">" + escHtml(d.before) + "</span> ← <span class=\"after\">" + escHtml(d.after) + "</span></div>").join("") + (p.comment ? '<div class="muted">+ תגובה</div>' : "") : "";
        tr.innerHTML = "<td>" + e.id + "</td><td>" + escHtml(e.item ? e.item.fields["System.Title"] || "" : "") + "</td><td>" + changes + '</td><td class="' + cls + '">' + escHtml(status) + "</td>";
        tb.appendChild(tr);
      });
      // Shared editors for required fields that are still empty
      entries.forEach(e => (e.plan && !e.done ? e.plan.missing : []).forEach(f => {
        if (!fills.has(f.ref)) {
          const ed = makeEditor(f, null, {type: e.plan.type, meta: e.plan.meta, onChange: () => { clearTimeout(recompute.t); recompute.t = setTimeout(recompute, 250); }});
          fills.set(f.ref, {ed, f, ids: new Set()});
          const row = document.createElement("div"); row.className = "eprow needed";
          row.innerHTML = '<div class="ephead"><label>' + escHtml(f.label) + '<span class="need">חובה</span></label></div>';
          row.appendChild(ed.el); fillBox.appendChild(row); row.dataset.ref = f.ref;
        }
        fills.get(f.ref).ids.add(e.id);
      }));
      if (fills.size) {
        fillBox.classList.remove("hidden");
        if (!fillBox.querySelector(".fillnote")) fillBox.insertAdjacentHTML("afterbegin", '<div class="fillnote">כדי לשמור צריך למלא גם את שדות החובה האלה. הערך יחול על כל הפריטים שחסר בהם השדה.</div>');
        fills.forEach((x, ref) => { const row = fillBox.querySelector('[data-ref="' + CSS.escape(ref) + '"] label'); if (row && !row.querySelector(".cnt")) row.insertAdjacentHTML("beforeend", '<span class="cnt"></span>'); if (row) row.querySelector(".cnt").textContent = " · " + x.ids.size + " פריטים"; });
      }
      const total = entries.filter(e => e.plan && (e.plan.diffs.length || e.plan.comment) && !e.done).length;
      ok.disabled = ready === 0;
      ok.textContent = ready === total || ready === 0 ? "שמירה ב-Azure (" + ready + ")" : "שמירת " + ready + " מתוך " + total + " פריטים";
    };
    ok.onclick = async () => {
      ok.disabled = true; cancel.disabled = true; ok.textContent = "שומר...";
      const updated = [];
      for (const e of entries) {
        const p = e.plan;
        if (!p || e.done || e.error || p.errors.length || p.missing.length || p.template || (!p.diffs.length && !p.comment)) continue;
        try { const u = await Edit.commit(p); e.done = true; updated.push(u); }
        catch (err) { e.saveError = err.message || String(err); if (err instanceof AuthError) break; }
      }
      People.fromItems(updated);
      if (updated.length) Results.update(updated);
      draw();
      ok.classList.add("hidden"); cancel.textContent = "סגירה"; cancel.disabled = false;
      fillBox.classList.add("hidden");
      head.innerHTML = "<b>" + (updated.length ? "✓ עודכנו " + updated.length + " פריטים" : "לא עודכנו פריטים") + "</b>";
    };
    cancel.onclick = () => { if (cancel.textContent === "ביטול") { head.innerHTML = "<b>העדכון בוטל</b>"; } acts.remove(); fillBox.remove(); };
    draw();
    scrollDown();
  }
};

/* ---------- Demo mode: in-memory work items ---------- */
const DemoDB = {
  map: new Map(),
  get(id) { return this.map.has(id) ? JSON.parse(JSON.stringify(this.map.get(id))) : null; },
  put(it) { this.map.set(it.id, JSON.parse(JSON.stringify(it))); },
  patch(id, rev, pairs, comment) {
    const it = this.map.get(id);
    if (!it) throw new Error("לא נמצא");
    if (it.rev !== rev) throw new ConflictError("הפריט עודכן בינתיים על ידי מישהו אחר. שלפו אותו מחדש ונסו שוב.");
    pairs.forEach(([ref, v]) => {
      if (v === null || v === undefined || v === "") delete it.fields[ref];
      else if (/AssignedTo|ActualAttendee|OwnerName|Owner$|ApproverName/.test(ref) && typeof v === "string") { const m = v.match(/^(.*?)\s*<([^>]+)>$/); it.fields[ref] = {displayName: m ? m[1] : v, uniqueName: m ? m[2] : v}; }
      else it.fields[ref] = v;
    });
    it.rev++;
    it.fields["System.ChangedDate"] = new Date().toISOString();
    if (comment) it.fields["System.CommentCount"] = (it.fields["System.CommentCount"] || 0) + 1;
    return new Promise(res => setTimeout(() => res(JSON.parse(JSON.stringify(it))), 250));
  }
};
