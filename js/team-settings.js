"use strict";
/* ============================================================
   Team settings screen: required fields per type and the
   Description template table. Edits a draft; "save" writes
   team-config.json to GitHub (or downloads it).
   ============================================================ */

const TeamUI = {
  draft: null, tab: "fields", type: "Feature", dirty: false, filter: "", onlyRequired: false,

  open() {
    this.draft = TeamConfig.clone();
    this.dirty = false;
    if (!this.draft.types.includes(this.type)) this.type = this.draft.types[0];
    $("teamPanel").classList.remove("hidden");
    this.render();
  },
  close(force) {
    if (this.dirty && !force) { this.confirmBar("יש שינויים שלא נשמרו. לסגור בלי לשמור?", "סגירה בלי שמירה", () => this.close(true)); return; }
    $("teamPanel").classList.add("hidden");
    $("input").focus();
  },
  markDirty() { this.dirty = true; this.status(); },
  status() {
    const s = $("teamStatus");
    const src = TeamConfig.source === "site" ? "" : " · נטען מברירת המחדל המובנית";
    const upd = TeamConfig.data.updatedAt ? "עודכן " + fmtDate(TeamConfig.data.updatedAt) + (TeamConfig.data.updatedBy ? " ע״י " + TeamConfig.data.updatedBy : "") : "עוד לא נשמר";
    s.textContent = (this.dirty ? "● יש שינויים שלא נשמרו · " : "") + upd + src;
    s.classList.toggle("dirty", this.dirty);
  },

  render() {
    document.querySelectorAll("#teamTabs [data-tab]").forEach(b => b.classList.toggle("on", b.dataset.tab === this.tab));
    const types = $("teamTypes"); types.innerHTML = "";
    $("teamTypesRow").classList.toggle("hidden", this.tab === "github");
    this.draft.types.forEach(t => {
      const b = document.createElement("button"); b.type = "button"; b.className = "seg" + (t === this.type ? " on" : "");
      const n = this.tab === "fields" ? (this.draft.requiredFields[t] || []).length : ((this.draft.templates[t] || {}).headings || []).length;
      b.textContent = t + (n ? " (" + n + ")" : "");
      b.onclick = () => { this.type = t; this.render(); };
      types.appendChild(b);
    });
    this.status();
    const body = $("teamBody"); body.innerHTML = "";
    if (this.tab === "fields") this.renderFields(body);
    else if (this.tab === "template") this.renderTemplate(body);
    else this.renderGithub(body);
  },

  /* ---------- Required fields ---------- */
  async renderFields(body) {
    const bar = document.createElement("div"); bar.className = "tbar";
    bar.innerHTML = '<input type="search" id="fieldFilter" placeholder="חיפוש שדה" aria-label="חיפוש שדה"><label class="chk"><input type="checkbox" id="onlyReq"> רק שדות חובה</label><span class="sp"></span><span class="muted" id="reqCount"></span>';
    body.appendChild(bar);
    const holder = document.createElement("div"); holder.className = "fieldgroups"; holder.innerHTML = '<div class="muted pad">טוען שדות מ-Azure DevOps...</div>';
    body.appendChild(holder);
    const ff = bar.querySelector("#fieldFilter"), oq = bar.querySelector("#onlyReq");
    ff.value = this.filter; oq.checked = this.onlyRequired;
    const type = this.type;
    let meta;
    try { meta = await Meta.typeMeta(type); }
    catch (e) { holder.innerHTML = '<div class="err">לא ניתן לטעון את השדות: ' + escHtml(e.message || e) + "</div>"; return; }
    if (type !== this.type || this.tab !== "fields") return;
    const draw = () => {
      const req = new Set(this.draft.requiredFields[type] || []);
      const q = norm(this.filter);
      holder.innerHTML = "";
      let total = 0;
      meta.groups.forEach(g => {
        const rows = g.fields.filter(f => (!q || norm(f.label + f.name + f.ref).includes(q)) && (!this.onlyRequired || f.azureRequired || req.has(f.ref)));
        if (!rows.length) return;
        const det = document.createElement("details"); det.className = "fgroup"; det.open = !g.collapsed || !!q || this.onlyRequired;
        det.innerHTML = '<summary>' + escHtml(g.label) + ' <span class="muted">(' + rows.length + ')</span></summary>';
        const tbl = document.createElement("table"); tbl.className = "ftable";
        tbl.innerHTML = "<thead><tr><th>שדה בטופס</th><th>שם במערכת</th><th>סוג</th><th>חובה</th></tr></thead>";
        const tb = document.createElement("tbody");
        rows.forEach(f => {
          const tr = document.createElement("tr");
          const on = f.azureRequired || req.has(f.ref);
          if (on) total++;
          tr.innerHTML = '<td>' + escHtml(f.label) + '</td><td class="ref" dir="ltr">' + escHtml(f.name !== f.label ? f.name : "") + ' <small>' + escHtml(f.ref) + '</small></td><td class="muted">' + escHtml(fieldKindLabel(f)) + "</td>";
          const td = document.createElement("td");
          const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = on; cb.disabled = f.azureRequired;
          cb.setAttribute("aria-label", "חובה: " + f.label);
          if (f.azureRequired) td.title = "חובה כבר ב-Azure DevOps";
          cb.onchange = () => {
            const list = new Set(this.draft.requiredFields[type] || []);
            cb.checked ? list.add(f.ref) : list.delete(f.ref);
            this.draft.requiredFields[type] = [...list];
            this.markDirty(); draw(); this.refreshTypeCounts();
          };
          td.appendChild(cb);
          if (f.azureRequired) { const s = document.createElement("span"); s.className = "lock"; s.textContent = "Azure"; td.appendChild(s); }
          tr.appendChild(td); tb.appendChild(tr);
        });
        tbl.appendChild(tb); det.appendChild(tbl); holder.appendChild(det);
      });
      if (!holder.children.length) holder.innerHTML = '<div class="muted pad">אין שדות שמתאימים לחיפוש.</div>';
      const teamN = (this.draft.requiredFields[type] || []).length;
      $("reqCount").textContent = "חובה בצוות: " + teamN + " · חובה ב-Azure: " + [...meta.byRef.values()].filter(f => f.azureRequired).length;
    };
    ff.oninput = () => { this.filter = ff.value; draw(); };
    oq.onchange = () => { this.onlyRequired = oq.checked; draw(); };
    if (!meta.hasLayout) { const n = document.createElement("div"); n.className = "notes"; n.textContent = "לא ניתן היה לטעון את מבנה הטופס, ולכן השדות מוצגים לפי שם המערכת."; body.insertBefore(n, holder); }
    draw();
  },
  refreshTypeCounts() {
    const btns = [...document.querySelectorAll("#teamTypes .seg")];
    this.draft.types.forEach((t, i) => {
      const n = this.tab === "fields" ? (this.draft.requiredFields[t] || []).length : ((this.draft.templates[t] || {}).headings || []).length;
      if (btns[i]) btns[i].textContent = t + (n ? " (" + n + ")" : "");
    });
  },

  /* ---------- Template table ---------- */
  tpl() {
    if (!this.draft.templates[this.type]) this.draft.templates[this.type] = {field: "System.Description", headingColor: "#0033CC", headings: []};
    return this.draft.templates[this.type];
  },
  renderTemplate(body) {
    const tpl = this.tpl();
    const intro = document.createElement("p"); intro.className = "muted";
    intro.textContent = tpl.headings.length
      ? "הכותרות ייכנסו ל-Description של " + this.type + " חדש. בשמירה, כותרת שמסומנת כחובה צריכה תוכן מתחתיה."
      : "אין תבנית ל-" + this.type + ". אפשר להוסיף כותרות כדי ליצור תבנית.";
    body.appendChild(intro);

    const tbl = document.createElement("table"); tbl.className = "ttable";
    tbl.innerHTML = "<thead><tr><th>סדר</th><th>כותרת</th><th>חובה</th><th>תוכן התחלתי מתחת לכותרת</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    tpl.headings.forEach((h, i) => {
      const tr = document.createElement("tr");
      const tdO = document.createElement("td"); tdO.className = "ord";
      const up = mkIconBtn("▲", "הזזה למעלה", i === 0, () => { [tpl.headings[i - 1], tpl.headings[i]] = [tpl.headings[i], tpl.headings[i - 1]]; this.markDirty(); this.render(); });
      const dn = mkIconBtn("▼", "הזזה למטה", i === tpl.headings.length - 1, () => { [tpl.headings[i + 1], tpl.headings[i]] = [tpl.headings[i], tpl.headings[i + 1]]; this.markDirty(); this.render(); });
      tdO.append(up, dn);
      const tdT = document.createElement("td");
      const inp = document.createElement("input"); inp.className = "hin"; inp.value = h.text; inp.setAttribute("aria-label", "כותרת " + (i + 1));
      const original = h.text;
      inp.oninput = () => { h.text = inp.value; this.markDirty(); this.preview(); };
      inp.onchange = () => {
        const t = inp.value.trim();
        if (original && t && headingKey(t) !== headingKey(original) && !h.aliases.some(a => headingKey(a) === headingKey(original))) h.aliases.push(original);
        h.text = t; this.preview();
      };
      tdT.appendChild(inp);
      if (h.aliases.length) { const s = document.createElement("div"); s.className = "alias"; s.textContent = "מזוהה גם כ: " + h.aliases.join(" · "); tdT.appendChild(s); }
      const tdR = document.createElement("td"); tdR.className = "c";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = h.required; cb.setAttribute("aria-label", "חובה: " + h.text);
      cb.onchange = () => { h.required = cb.checked; this.markDirty(); this.preview(); };
      tdR.appendChild(cb);
      const tdC = document.createElement("td");
      const ce = document.createElement("div"); ce.className = "rich"; ce.contentEditable = "true"; ce.innerHTML = h.content || "";
      ce.setAttribute("aria-label", "תוכן התחלתי: " + h.text);
      ce.oninput = () => { h.content = ce.innerHTML; this.markDirty(); this.preview(); };
      ce.onblur = () => { h.content = sanitizeTemplateHtml(ce.innerHTML); };
      tdC.appendChild(ce);
      const tdX = document.createElement("td");
      tdX.appendChild(mkIconBtn("✕", "מחיקת כותרת", false, () => { tpl.headings.splice(i, 1); this.markDirty(); this.render(); }, "del"));
      tr.append(tdO, tdT, tdR, tdC, tdX); tb.appendChild(tr);
    });
    tbl.appendChild(tb); body.appendChild(tbl);

    const acts = document.createElement("div"); acts.className = "tbar";
    const add = document.createElement("button"); add.type = "button"; add.className = "btn ghost"; add.textContent = "+ כותרת";
    add.onclick = () => { tpl.headings.push({text: "כותרת חדשה", required: false, content: "", aliases: []}); this.markDirty(); this.render(); const ins = document.querySelectorAll(".hin"); if (ins.length) { ins[ins.length - 1].focus(); ins[ins.length - 1].select(); } };
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "btn ghost"; reset.textContent = "איפוס לברירת המחדל";
    reset.onclick = () => this.confirmBar("להחזיר את התבנית של " + this.type + " לברירת המחדל?", "איפוס", () => {
      const d = TEAM_DEFAULT.templates[this.type];
      this.draft.templates[this.type] = d ? JSON.parse(JSON.stringify(d)) : {field: "System.Description", headingColor: "#0033CC", headings: []};
      this.markDirty(); this.render();
    });
    const colorL = document.createElement("label"); colorL.className = "chk"; colorL.textContent = "צבע כותרות ";
    const color = document.createElement("input"); color.type = "color"; color.value = tpl.headingColor || "#0033CC";
    color.oninput = () => { tpl.headingColor = color.value; this.markDirty(); this.preview(); };
    colorL.appendChild(color);
    const sp = document.createElement("span"); sp.className = "sp";
    acts.append(add, reset, sp, colorL); body.appendChild(acts);

    const pv = document.createElement("div"); pv.className = "pvwrap";
    pv.innerHTML = '<div class="pvhead">תצוגה מקדימה, כפי שייראה ב-Description</div><div class="pv" id="tplPreview"></div>';
    body.appendChild(pv);
    this.preview();
  },
  preview() {
    const el = $("tplPreview"); if (!el) return;
    const tpl = this.tpl();
    el.innerHTML = tpl.headings.length ? templateHtml({...tpl, headings: tpl.headings.map(h => ({...h, content: sanitizeTemplateHtml(h.content)}))}) : '<span class="muted">אין כותרות</span>';
    el.querySelectorAll("b").forEach((b, i) => { const h = tpl.headings[i]; if (h && h.required) b.insertAdjacentHTML("beforeend", ' <span class="reqmark">חובה</span>'); });
  },

  /* ---------- GitHub connection ---------- */
  renderGithub(body) {
    const has = !!GitHubStore.token();
    body.innerHTML =
      '<div class="ghbox">' +
      "<p>כדי ששינויים בהגדרות יגיעו לכל הצוות, הם נשמרים לקובץ <code dir=\"ltr\">team-config.json</code> ב-GitHub, ו-Vercel מפרסם אותם תוך כדקה.</p>" +
      "<ol><li>פתחו את <a target=\"_blank\" rel=\"noopener\" href=\"https://github.com/settings/personal-access-tokens/new\">יצירת token חדש ב-GitHub</a> (Fine-grained).</li>" +
      "<li>תחת <b>Repository access</b> בחרו <b>Only select repositories</b> ← <code dir=\"ltr\">" + GITHUB.owner + "/" + GITHUB.repo + "</code>.</li>" +
      "<li>תחת <b>Permissions ← Repository permissions</b> הגדירו <b>Contents: Read and write</b>. שום הרשאה אחרת.</li>" +
      "<li>צרו את ה-token והדביקו אותו כאן.</li></ol>" +
      '<label for="ghTok">GitHub token</label><input class="field" id="ghTok" type="password" autocomplete="off" spellcheck="false" placeholder="' + (has ? "שמור token. הדביקו חדש כדי להחליף" : "github_pat_...") + '">' +
      '<label class="chk"><input type="checkbox" id="ghRemember"> לזכור במחשב הזה</label>' +
      '<div class="tbar"><button class="btn" type="button" id="ghSave">שמירה ובדיקה</button>' + (has ? '<button class="btn ghost" type="button" id="ghClear">הסרת token</button>' : "") + '<span class="muted" id="ghMsg">' + (has ? "יש token שמור" : "אין token") + "</span></div>" +
      '<p class="muted">רק מי שיש לו token כזה יכול לשמור הגדרות לצוות. כל השאר רואים את ההגדרות ופועלים לפיהן.</p></div>';
    $("ghSave").onclick = async () => {
      const v = $("ghTok").value.trim();
      if (v) GitHubStore.setToken(v, $("ghRemember").checked);
      $("ghMsg").textContent = "בודק...";
      try { const n = await GitHubStore.test(); $("ghMsg").textContent = "מחובר ל-" + n + " עם הרשאת כתיבה"; $("ghTok").value = ""; }
      catch (e) { $("ghMsg").textContent = e.message; }
    };
    if ($("ghClear")) $("ghClear").onclick = () => { GitHubStore.setToken(""); this.render(); };
  },

  /* ---------- Save ---------- */
  prepared() {
    const d = JSON.parse(JSON.stringify(this.draft));
    Object.keys(d.templates).forEach(t => {
      const tp = d.templates[t];
      tp.headings = (tp.headings || []).filter(h => String(h.text || "").trim()).map(h => ({text: h.text.trim(), required: !!h.required, content: sanitizeTemplateHtml(h.content || ""), aliases: (h.aliases || []).filter(Boolean)}));
      if (!tp.headings.length) delete d.templates[t];
    });
    d.updatedAt = new Date().toISOString();
    d.updatedBy = Auth.userName || "";
    return d;
  },
  async save(force) {
    if (!GitHubStore.token()) { this.tab = "github"; this.render(); toast("כדי לשמור לצוות צריך קודם לחבר GitHub token"); return; }
    const d = this.prepared();
    const btn = $("teamSave"); btn.disabled = true; btn.textContent = "שומר...";
    try {
      await GitHubStore.save(d, TeamConfig.data.updatedAt, force);
      TeamConfig.data = TeamConfig.normalize(d); TeamConfig.source = "site";
      this.draft = TeamConfig.clone(); this.dirty = false; this.render();
      toast("נשמר ב-GitHub. כל הצוות יקבל את ההגדרות תוך כדקה");
    } catch (e) {
      if (e.conflict) this.confirmBar(e.message + " לשמור בכל זאת ולדרוס?", "לשמור ולדרוס", () => this.save(true));
      else toast("השמירה נכשלה: " + e.message);
    } finally { btn.disabled = false; btn.textContent = "שמירה לצוות"; }
  },
  download() {
    const blob = new Blob([JSON.stringify(this.prepared(), null, 2) + "\n"], {type: "application/json"});
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "team-config.json";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  },

  confirmBar(text, okLabel, onOk) {
    const bar = $("teamConfirm");
    bar.innerHTML = "";
    const t = document.createElement("span"); t.textContent = text;
    const ok = document.createElement("button"); ok.type = "button"; ok.className = "btn"; ok.textContent = okLabel;
    const no = document.createElement("button"); no.type = "button"; no.className = "btn ghost"; no.textContent = "ביטול";
    ok.onclick = () => { bar.classList.add("hidden"); onOk(); };
    no.onclick = () => bar.classList.add("hidden");
    bar.append(t, ok, no); bar.classList.remove("hidden"); ok.focus();
  },

  init() {
    $("teamBtn").onclick = () => this.open();
    $("teamClose").onclick = () => this.close();
    $("teamSave").onclick = () => this.save(false);
    $("teamDownload").onclick = () => this.download();
    document.querySelectorAll("#teamTabs [data-tab]").forEach(b => b.onclick = () => { this.tab = b.dataset.tab; this.render(); });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("teamPanel").classList.contains("hidden") && $("lightbox").classList.contains("hidden")) this.close(); });
  }
};

function mkIconBtn(txt, label, disabled, fn, cls) {
  const b = document.createElement("button"); b.type = "button"; b.className = "ib" + (cls ? " " + cls : "");
  b.textContent = txt; b.title = label; b.setAttribute("aria-label", label); b.disabled = !!disabled; b.onclick = fn; return b;
}
function fieldKindLabel(f) {
  if (f.isIdentity) return "אדם";
  if (f.allowed && f.allowed.length) return "רשימה";
  return ({string: "טקסט", plainText: "טקסט", html: "טקסט עשיר", integer: "מספר", double: "מספר", dateTime: "תאריך", boolean: "כן/לא", treePath: "נתיב", identity: "אדם"})[f.type] || f.type;
}
