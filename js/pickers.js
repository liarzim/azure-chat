"use strict";
/* ============================================================
   Pickers used in the edit / create panel:
   - People: the project's people as a searchable list
   - Area / Iteration: an expandable tree; the value is the full path
   ============================================================ */

const Pickers = {
  open: null,
  closeAll(except) { document.querySelectorAll(".pk-panel:not(.hidden)").forEach(p => { if (p !== except) p.classList.add("hidden"); }); },
  init() {
    document.addEventListener("mousedown", e => { if (!e.target.closest(".picker")) this.closeAll(); });
  }
};

/* ---------- People ---------- */
function makePersonPicker(f, value, onChange) {
  const wrap = document.createElement("div"); wrap.className = "picker";
  const inp = document.createElement("input"); inp.className = "pk-input"; inp.setAttribute("aria-label", f.label);
  inp.setAttribute("role", "combobox"); inp.setAttribute("aria-expanded", "false"); inp.autocomplete = "off";
  inp.placeholder = "בחרו מהרשימה או הקלידו שם";
  const panel = document.createElement("div"); panel.className = "pk-panel hidden"; panel.setAttribute("role", "listbox");
  const note = document.createElement("div"); note.className = "pk-note hidden";
  wrap.append(inp, panel, note);

  let selected = isEmptyValue(f, value) ? null : (typeof value === "object" ? identityValue(value) : String(value));
  let active = 0, shown = [];
  inp.value = selected ? identityText(selected) : "";

  const choose = v => {
    selected = v; inp.value = v ? identityText(v) : ""; inp.classList.remove("invalid", "pending"); note.classList.add("hidden");
    panel.classList.add("hidden"); inp.setAttribute("aria-expanded", "false"); onChange();
  };
  const render = async () => {
    panel.innerHTML = '<div class="pk-empty">טוען אנשים...</div>';
    const all = await People.all();
    const q = norm(inp.value === identityText(selected || "") ? "" : inp.value);
    const me = People.me();
    const opts = [];
    if (me && (!q || norm(me.displayName + me.uniqueName + "אני").includes(q))) opts.push({p: me, label: "אני · " + me.displayName});
    if (!f.azureRequired && !q) opts.push({p: null, label: "— ללא —"});
    all.filter(p => !me || p.uniqueName.toLowerCase() !== me.uniqueName.toLowerCase()).filter(p => !q || norm(p.displayName + p.uniqueName).includes(q)).slice(0, 200)
      .forEach(p => opts.push({p, label: p.displayName}));
    shown = opts; active = Math.min(active, Math.max(0, opts.length - 1));
    panel.innerHTML = "";
    if (!opts.length) { panel.innerHTML = '<div class="pk-empty">לא נמצא. אפשר להקליד אימייל מלא.</div>'; }
    opts.forEach((o, i) => {
      const d = document.createElement("div"); d.className = "pk-opt" + (i === active ? " on" : ""); d.setAttribute("role", "option");
      d.innerHTML = escHtml(o.label) + (o.p ? ' <small dir="ltr">' + escHtml(o.p.uniqueName) + "</small>" : "");
      d.onmousedown = e => { e.preventDefault(); choose(o.p ? identityValue(o.p) : null); };
      panel.appendChild(d);
    });
    if (People.source === "recent") panel.insertAdjacentHTML("beforeend", '<div class="pk-hint">מוצגים אנשים שעבדו בפרויקט ב-90 הימים האחרונים. לרשימה המלאה של הצוותים, צרו טוקן עם הרשאת Project and Team: Read.</div>');
  };
  const openPanel = () => { Pickers.closeAll(panel); panel.classList.remove("hidden"); inp.setAttribute("aria-expanded", "true"); render(); };
  inp.onfocus = openPanel;
  inp.onclick = openPanel;
  let t; inp.oninput = () => { selected = null; inp.classList.toggle("pending", !!inp.value.trim()); active = 0; clearTimeout(t); t = setTimeout(render, 120); if (panel.classList.contains("hidden")) openPanel(); onChange(); };
  inp.onkeydown = e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (panel.classList.contains("hidden")) openPanel();
      active = Math.max(0, Math.min(shown.length - 1, active + (e.key === "ArrowDown" ? 1 : -1)));
      [...panel.querySelectorAll(".pk-opt")].forEach((x, i) => { x.classList.toggle("on", i === active); if (i === active) x.scrollIntoView({block: "nearest"}); });
    } else if (e.key === "Enter") {
      e.preventDefault(); const o = shown[active]; if (o) choose(o.p ? identityValue(o.p) : null);
    } else if (e.key === "Escape") { e.stopPropagation(); panel.classList.add("hidden"); inp.setAttribute("aria-expanded", "false"); }
  };
  inp.onblur = () => setTimeout(() => {
    if (wrap.contains(document.activeElement)) return;
    panel.classList.add("hidden"); inp.setAttribute("aria-expanded", "false");
    const txt = inp.value.trim();
    inp.classList.remove("pending");
    if (selected || !txt) { if (!txt && selected) choose(null); else onChange(); return; }
    const hits = People.list().filter(p => norm(p.displayName) === norm(txt) || norm(p.uniqueName) === norm(txt));
    if (hits.length === 1) { choose(identityValue(hits[0])); return; }
    if (/^[^\s@]+@[^\s@]+$/.test(txt)) { choose(txt); return; }
    inp.classList.remove("pending"); inp.classList.add("invalid"); note.textContent = "בחרו אדם מהרשימה"; note.classList.remove("hidden"); onChange();
  }, 150);
  return {el: wrap, get: () => selected, set: v => { selected = v || null; inp.value = v ? identityText(v) : ""; }};
}

/* ---------- Area / Iteration tree ---------- */
function makeTreePicker(f, value, kind, onChange) {
  const wrap = document.createElement("div"); wrap.className = "picker";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "pk-btn"; btn.setAttribute("aria-label", f.label); btn.setAttribute("aria-haspopup", "tree");
  const panel = document.createElement("div"); panel.className = "pk-panel tree hidden";
  wrap.append(btn, panel);
  let selected = value || null;
  const expanded = new Set();
  const draw = () => {
    if (!selected) { btn.innerHTML = '<span class="pk-ph">בחרו מהעץ</span>'; return; }
    const parts = String(selected).split("\\");
    btn.innerHTML = "<b>" + escHtml(parts[parts.length - 1]) + '</b><small dir="ltr">' + escHtml(parts.join(" › ")) + "</small>";
  };
  draw();
  const today = new Date().toISOString().slice(0, 10);
  const isCurrent = n => n.start && n.finish && n.start.slice(0, 10) <= today && today <= n.finish.slice(0, 10);
  const fmtRange = n => n.start && n.finish ? fmtDate(n.start) + " – " + fmtDate(n.finish) : "";

  const renderTree = (root, q) => {
    const box = panel.querySelector(".pk-tree"); box.innerHTML = "";
    const qn = norm(q || "");
    const matches = n => !qn || norm(n.name).includes(qn) || norm(n.path).includes(qn);
    const visible = n => matches(n) || (n.children || []).some(visible);
    const walk = (n, depth, ul) => {
      if (qn && !visible(n)) return;
      const li = document.createElement("li"); li.setAttribute("role", "treeitem");
      const kids = (n.children || []).length > 0;
      const open = qn ? true : expanded.has(n.path);
      if (kids) li.setAttribute("aria-expanded", String(open));
      const row = document.createElement("div"); row.className = "pk-node" + (n.path === selected ? " sel" : "");
      row.style.paddingInlineStart = (6 + depth * 16) + "px";
      const tg = document.createElement("button"); tg.type = "button"; tg.className = "pk-tg"; tg.textContent = kids ? (open ? "▾" : "◂") : ""; tg.tabIndex = -1;
      tg.setAttribute("aria-label", open ? "סגירה" : "פתיחה");
      if (kids) tg.onclick = e => { e.stopPropagation(); open ? expanded.delete(n.path) : expanded.add(n.path); renderTree(root, panel.querySelector(".pk-search").value); };
      const name = document.createElement("button"); name.type = "button"; name.className = "pk-name";
      name.innerHTML = escHtml(n.name) + (kind === "iteration" && fmtRange(n) ? ' <small class="pk-dates" dir="ltr">' + escHtml(fmtRange(n)) + "</small>" : "") + (kind === "iteration" && isCurrent(n) ? ' <span class="pk-cur">נוכחי</span>' : "");
      name.onclick = () => { selected = n.path; draw(); panel.classList.add("hidden"); btn.focus(); onChange(); };
      row.append(tg, name); li.appendChild(row); ul.appendChild(li);
      if (kids && open) { const sub = document.createElement("ul"); sub.setAttribute("role", "group"); li.appendChild(sub); n.children.forEach(c => walk(c, depth + 1, sub)); }
    };
    const ul = document.createElement("ul"); ul.setAttribute("role", "tree"); box.appendChild(ul);
    walk(root, 0, ul);
    if (!ul.children.length) box.innerHTML = '<div class="pk-empty">לא נמצא</div>';
    const sel = box.querySelector(".pk-node.sel"); if (sel) sel.scrollIntoView({block: "nearest"});
  };
  btn.onclick = async () => {
    if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
    Pickers.closeAll(panel);
    panel.classList.remove("hidden");
    panel.innerHTML = '<input class="pk-search" type="search" placeholder="חיפוש" aria-label="חיפוש ב-' + escHtml(f.label) + '"><div class="pk-tree"><div class="pk-empty">טוען...</div></div>';
    let root;
    try { root = (await Meta.classPaths()).trees[kind]; } catch (e) { panel.querySelector(".pk-tree").innerHTML = '<div class="pk-empty">לא ניתן לטעון: ' + escHtml(e.message) + "</div>"; return; }
    if (!root) { panel.querySelector(".pk-tree").innerHTML = '<div class="pk-empty">אין נתונים</div>'; return; }
    expanded.add(root.path);
    if (selected) { const parts = String(selected).split("\\"); for (let i = 1; i < parts.length; i++) expanded.add(parts.slice(0, i).join("\\")); }
    const s = panel.querySelector(".pk-search");
    s.oninput = () => renderTree(root, s.value);
    s.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); panel.classList.add("hidden"); btn.focus(); } };
    renderTree(root, "");
    s.focus();
  };
  return {el: wrap, get: () => selected, set: v => { selected = v || null; draw(); }};
}

/* ---------- Multi select with checkboxes and search (squads, area paths) ----------
   load(): [{value, label, depth?, hint?}] */
function makeMultiPicker(opts) {
  const wrap = document.createElement("div"); wrap.className = "picker mpk";
  const btn = document.createElement("button"); btn.type = "button"; btn.className = "pk-btn"; btn.setAttribute("aria-label", opts.label); btn.setAttribute("aria-haspopup", "listbox");
  const panel = document.createElement("div"); panel.className = "pk-panel hidden";
  wrap.append(btn, panel);
  let selected = (opts.value || []).slice();
  const draw = () => {
    if (!selected.length) { btn.innerHTML = '<span class="pk-ph">' + escHtml(opts.placeholder || "בחירה") + "</span>"; return; }
    const short = v => opts.short ? opts.short(v) : v;
    btn.innerHTML = '<span class="mpk-chips">' + selected.map(v => '<span class="mpk-chip" title="' + escHtml(v) + '">' + escHtml(short(v)) + "</span>").join("") + "</span>";
  };
  draw();
  let list = null;
  const expanded = new Set();
  const render = q => opts.tree ? renderTree(q) : renderFlat(q);
  /* Tree (area paths): choosing a node covers everything under it. Those show as checked and locked,
     and only the top node is kept (it already includes its children). */
  const isUnder = (v, parent) => String(v).toLowerCase().startsWith(String(parent).toLowerCase() + "\\");
  const renderTree = q => {
    const box = panel.querySelector(".mpk-list"); box.innerHTML = "";
    const qn = norm(q || "");
    const hit = o => !qn || norm(o.label + " " + o.value).includes(qn);
    const show = new Set();
    list.forEach(o => { if (hit(o)) { show.add(o.value); list.forEach(a => { if (isUnder(o.value, a.value)) show.add(a.value); }); } });
    const ul = document.createElement("div"); ul.setAttribute("role", "tree"); box.appendChild(ul);
    list.forEach(o => {
      if (!show.has(o.value)) return;
      // hidden while an ancestor is collapsed (search opens everything)
      if (!qn && list.some(a => isUnder(o.value, a.value) && !expanded.has(a.value))) return;
      const kids = list.some(c => c.parent === o.value);
      const open = qn ? true : expanded.has(o.value);
      const covered = selected.some(s => isUnder(o.value, s));
      const row = document.createElement("div"); row.className = "mpk-node"; row.setAttribute("role", "treeitem"); row.style.paddingInlineStart = (4 + (o.depth || 0) * 16) + "px";
      if (kids) row.setAttribute("aria-expanded", String(open));
      const tg = document.createElement("button"); tg.type = "button"; tg.className = "pk-tg"; tg.tabIndex = -1; tg.textContent = kids ? (open ? "▾" : "◂") : "";
      tg.setAttribute("aria-label", (open ? "סגירה: " : "פתיחה: ") + o.label);
      if (kids) tg.onclick = e => { e.preventDefault(); open ? expanded.delete(o.value) : expanded.add(o.value); render(panel.querySelector(".pk-search").value); };
      const l = document.createElement("label"); l.className = "mpk-opt";
      const cb = document.createElement("input"); cb.type = "checkbox";
      cb.checked = covered || selected.includes(o.value); cb.disabled = covered;
      cb.indeterminate = !cb.checked && selected.some(s => isUnder(s, o.value));
      if (covered) l.title = "נבחר כי הוא מתחת ל-Area שנבחר";
      cb.onchange = () => {
        if (cb.checked) selected = [...selected.filter(s => !isUnder(s, o.value)), o.value];   // the parent replaces its children
        else selected = selected.filter(s => s !== o.value);
        render(panel.querySelector(".pk-search").value); live();
      };
      l.append(cb, document.createTextNode(" " + o.label));
      if (kids && cb.checked && !covered) { const s = document.createElement("small"); s.textContent = "כולל כל מה שמתחת"; l.appendChild(s); }
      row.append(tg, l); ul.appendChild(row);
    });
    if (!ul.children.length) box.innerHTML = '<div class="pk-empty">לא נמצא</div>';
  };
  const renderFlat = q => {
    const box = panel.querySelector(".mpk-list"); box.innerHTML = "";
    const qn = norm(q || "");
    const rows = list.filter(o => !qn || norm(o.label + " " + o.value).includes(qn));
    if (!rows.length) { box.innerHTML = '<div class="pk-empty">לא נמצא</div>'; return; }
    rows.forEach(o => {
      const l = document.createElement("label"); l.className = "mpk-opt"; l.style.paddingInlineStart = (8 + (qn ? 0 : (o.depth || 0) * 16)) + "px";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = selected.includes(o.value);
      cb.onchange = () => { selected = cb.checked ? [...selected, o.value] : selected.filter(v => v !== o.value); live(); };
      l.append(cb, document.createTextNode(" " + o.label));
      if (o.hint && qn) { const s = document.createElement("small"); s.dir = "ltr"; s.textContent = o.hint; l.appendChild(s); }
      box.appendChild(l);
    });
  };
  let saved = JSON.stringify(selected);
  const commit = () => { const now = JSON.stringify(selected); if (now === saved) return; saved = now; opts.onChange(selected.slice()); };
  // the button shows the choice at once; it is saved at once too, unless the caller saves only when the list closes
  const live = () => { draw(); if (!opts.saveOnClose) commit(); };
  const close = apply => {
    panel.classList.add("hidden");
    if (apply) { draw(); commit(); }
  };
  btn.onclick = async () => {
    if (!panel.classList.contains("hidden")) { close(true); return; }
    Pickers.closeAll(panel); panel.classList.remove("hidden");
    panel.innerHTML = '<input class="pk-search" type="search" placeholder="חיפוש" aria-label="חיפוש ב-' + escHtml(opts.label) + '"><div class="mpk-list"><div class="pk-empty">טוען...</div></div>' +
      '<div class="mpk-bar"><button type="button" class="btn ghost mini mpk-clear">ניקוי</button><span class="sp"></span><button type="button" class="btn mini mpk-ok">אישור</button></div>';
    panel.querySelector(".mpk-ok").onclick = () => { close(true); btn.focus(); };
    panel.querySelector(".mpk-clear").onclick = () => { selected = []; render(panel.querySelector(".pk-search").value); live(); };
    try {
      list = await opts.load();
      if (opts.tree && !expanded.size) {          // open the top level and the way to what is already chosen
        list.filter(o => !o.parent).forEach(o => expanded.add(o.value));
        selected.forEach(s => list.forEach(a => { if (isUnder(s, a.value)) expanded.add(a.value); }));
      }
    } catch (e) { panel.querySelector(".mpk-list").innerHTML = '<div class="pk-empty">לא ניתן לטעון: ' + escHtml(e.message || e) + "</div>"; return; }
    const s = panel.querySelector(".pk-search");
    s.oninput = () => render(s.value);
    s.onkeydown = e => { if (e.key === "Escape") { e.stopPropagation(); close(true); btn.focus(); } };
    render(""); s.focus();
  };
  // clicking outside applies the choice (like closing a dropdown)
  document.addEventListener("mousedown", e => { if (!panel.classList.contains("hidden") && !wrap.contains(e.target)) close(true); });
  return {el: wrap, get: () => selected.slice(), set: v => { selected = (v || []).slice(); saved = JSON.stringify(selected); draw(); }};
}
/* Area or iteration tree flattened for makeMultiPicker */
async function treeOptions(kind) {
  const root = (await Meta.classPaths()).trees[kind];
  const out = [];
  const walk = (n, d, parent) => { out.push({value: n.path, label: n.name, depth: d, hint: n.path, parent}); (n.children || []).forEach(c => walk(c, d + 1, n.path)); };
  if (root) walk(root, 0, null);
  return out;
}
