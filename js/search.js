"use strict";
/* ============================================================
   Chat search: words instead of numbers. Finds items by title
   (part of a word) or Description (whole words), shows a list to
   pick from (one, several or all), and shows the picked items as
   the usual table.
   ============================================================ */

const ChatSearch = {
  LIMIT: 50,
  PREFIX: /^\s*(חפש|חפשי|חיפוש|תחפש|search|find)\s*[:：]?\s*/i,

  explicit(text) { return this.PREFIX.test(text); },
  queryFrom(text) {
    const q = String(text || "").replace(this.PREFIX, "").replace(/\s+/g, " ").trim();
    return q.length >= 2 ? q : "";
  },

  async run(q, includeClosed, el) {
    if (!q) { addMsg("bot", "כתבו לפחות 2 תווים לחיפוש."); return; }
    busy = true; $("sendBtn").disabled = true;
    const wait = el ? null : addMsg("bot typing", 'מחפש "' + escHtml(q) + '"...');
    if (el) el.classList.add("loading");
    try {
      const found = await searchItems(q, null, this.LIMIT, {includeClosed: !!includeClosed});
      People.fromItems(found);
      if (wait) wait.remove();
      this.render(q, !!includeClosed, found, el);
    } catch (e) {
      if (wait) wait.remove();
      if (el) el.classList.remove("loading");
      addMsg("bot error", escHtml(e.message || String(e)));
      if (e instanceof AuthError && Auth.mode === "pat") { await Auth.logout(); setTimeout(() => showLogin(e.message), 1500); }
    } finally { busy = false; $("sendBtn").disabled = false; $("input").focus(); }
  },

  render(q, includeClosed, found, el) {
    if (!el) el = addMsg("bot", "");
    el.classList.remove("loading");
    el.innerHTML = "";
    const card = document.createElement("div"); card.className = "srch";
    const head = document.createElement("div"); head.className = "srch-head";
    const title = document.createElement("div"); title.className = "srch-title";
    title.innerHTML = found.length
      ? "מצאתי <b>" + found.length + (found.length >= this.LIMIT ? "+" : "") + "</b> פריטים " + (includeClosed ? "" : "פתוחים ") + 'עבור "<b>' + escHtml(q) + '</b>"'
      : 'לא מצאתי פריטים ' + (includeClosed ? "" : "פתוחים ") + 'עבור "<b>' + escHtml(q) + '</b>"';
    const scope = document.createElement("button"); scope.type = "button"; scope.className = "btn ghost sm";
    scope.textContent = includeClosed ? "רק פתוחים" : "כולל סגורים";
    scope.onclick = () => { if (!busy) this.run(q, !includeClosed, el); };
    head.append(title, scope);
    card.appendChild(head);

    if (!found.length) {
      card.insertAdjacentHTML("beforeend", '<div class="srch-empty">נסו מילה אחרת או קצרה יותר' + (includeClosed ? "" : ', או "כולל סגורים"') + ". בכותרת מחפשים גם חלק ממילה, בתיאור רק מילים שלמות.</div>");
      el.appendChild(card); return;
    }

    const list = document.createElement("div"); list.className = "srch-list"; list.setAttribute("role", "group"); list.setAttribute("aria-label", "תוצאות החיפוש");
    const boxes = [];
    found.forEach(it => {
      const f = it.fields, row = document.createElement("div"); row.className = "srch-row";
      const id = "srch-" + Math.random().toString(36).slice(2) + "-" + it.id;
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.id = id; cb.value = String(it.id);
      const lab = document.createElement("label"); lab.htmlFor = id; lab.className = "srch-lab";
      const who = f["System.AssignedTo"] ? (f["System.AssignedTo"].displayName || String(f["System.AssignedTo"])) : "";
      const path = String(f["System.IterationPath"] || "").split("\\").pop();
      lab.innerHTML = '<span class="srch-id" dir="ltr">' + it.id + '</span><span class="srch-type">' + escHtml(f["System.WorkItemType"] || "") + '</span>' +
        '<span class="srch-t">' + escHtml(f["System.Title"] || "") + "</span>" +
        '<span class="srch-meta">' + escHtml([f["System.State"], who, path].filter(Boolean).join(" · ")) + "</span>";
      const one = document.createElement("button"); one.type = "button"; one.className = "btn ghost sm srch-one"; one.textContent = "הצג";
      one.setAttribute("aria-label", "הצגת פריט " + it.id + " בטבלה");
      one.onclick = () => this.show([it.id]);
      cb.onchange = () => { row.classList.toggle("on", cb.checked); update(); };
      row.append(cb, lab, one); list.appendChild(row); boxes.push(cb);
    });
    card.appendChild(list);

    const foot = document.createElement("div"); foot.className = "srch-foot";
    const allId = "srch-all-" + Math.random().toString(36).slice(2);
    const all = document.createElement("input"); all.type = "checkbox"; all.id = allId;
    const allLab = document.createElement("label"); allLab.htmlFor = allId; allLab.textContent = "בחירת הכל";
    const go = document.createElement("button"); go.type = "button"; go.className = "btn";
    const update = () => {
      const n = boxes.filter(b => b.checked).length;
      go.disabled = !n; go.textContent = n ? "הצג בטבלה (" + n + ")" : "בחרו פריטים";
      all.checked = n === boxes.length; all.indeterminate = n > 0 && n < boxes.length;
    };
    all.onchange = () => { boxes.forEach(b => { b.checked = all.checked; b.closest(".srch-row").classList.toggle("on", b.checked); }); update(); };
    go.onclick = () => this.show(boxes.filter(b => b.checked).map(b => Number(b.value)));
    const sp = document.createElement("span"); sp.className = "sp";
    foot.append(all, allLab, sp, go);
    card.appendChild(foot);
    el.appendChild(card);
    update();
  },

  show(ids) {
    if (!ids.length || busy) return;
    addMsg("user", escHtml(ids.join(", ")));
    const fields = getDefaultFields().filter(f => !sameField(f, "ID")); fields.unshift("ID");
    return runLookup({cmd: "fetch", ids, fields, customized: false});
  }
};
