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
