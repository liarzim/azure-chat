"use strict";
/* ============================================================
   Team settings screen: required fields per type and the
   Description template table. Edits a draft; "save" writes
   team-config.json to GitHub (or downloads it).
   ============================================================ */

const TeamUI = {
  draft: null, tab: "fields", type: "Feature", dirty: false, filter: "", onlyRequired: false,

  /* ---------- GitHub connection: the bar on top of every tab, and the GitHub tab ---------- */
  ghUi() {
    const c = GitHubStore.conn, has = !!GitHubStore.token(), ok = GitHubStore.connected();
    const msg = $("ghBarMsg"), tok = $("ghBarTok"), chk = $("ghBarCheck"), chg = $("ghBarChange");
    msg.classList.remove("conn-ok", "conn-bad", "muted");
    if (c.state === "checking") { msg.textContent = "בודק..."; msg.classList.add("muted"); }
    else if (ok) { msg.textContent = "✓ מחובר ל-" + c.repo; msg.classList.add("conn-ok"); }
    else if (c.state === "bad" && c.token === GitHubStore.token()) { msg.textContent = "✕ " + c.error; msg.classList.add("conn-bad"); }
    else { msg.textContent = has ? "יש token, עוד לא נבדק" : "לא מחובר. כדי לשמור לצוות, הדביקו token"; msg.classList.add(has ? "muted" : "conn-bad"); }
    const editing = this.ghEditing || !has || (c.state === "bad" && c.token === GitHubStore.token());
    tok.classList.toggle("hidden", ok && !this.ghEditing);
    chg.classList.toggle("hidden", !ok || this.ghEditing);
    // the check button is grey while the connection is fine; it wakes up when a new token is typed
    chk.disabled = c.state === "checking" || (ok && !tok.value.trim());
    chk.title = ok ? "החיבור תקין" : "";
    // save is grey until the connection works
    const save = $("teamSave");
    save.disabled = !ok;
    save.title = ok ? "" : "קודם מחברים GitHub token (למעלה)";
    // the GitHub tab shows the same state
    const gm = $("ghMsg");
    if (gm) {
      gm.className = msg.className; gm.textContent = msg.textContent;
      const gb = $("ghSave"); if (gb) gb.disabled = chk.disabled && !($("ghTok") && $("ghTok").value.trim());
    }
    return editing;
  },
  async ghCheck(value) {
    if (value) { GitHubStore.setToken(value); this.ghEditing = false; }
    if (!GitHubStore.token()) { this.ghUi(); $("ghBarTok").focus(); return; }
    GitHubStore.conn = {state: "checking", repo: "", error: "", token: GitHubStore.token()}; this.ghUi();
    await GitHubStore.check();
    $("ghBarTok").value = ""; if ($("ghTok")) $("ghTok").value = "";
    this.ghUi();
  },
  ghInit() {
    $("ghBarCheck").onclick = () => this.ghCheck($("ghBarTok").value.trim());
    $("ghBarTok").oninput = () => this.ghUi();
    $("ghBarTok").onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); $("ghBarCheck").click(); } };
    $("ghBarChange").onclick = () => { this.ghEditing = true; this.ghUi(); $("ghBarTok").focus(); };
    $("ghBarHelp").onclick = () => { this.tab = "github"; this.render(); };
  },

  open() {
    this.draft = TeamConfig.clone();
    this.dirty = false;
    if (!this.draft.types.includes(this.type)) this.type = this.draft.types[0];
    $("teamPanel").classList.remove("hidden");
    this.render();
    // a token from earlier in this tab: check it once, quietly
    if (GitHubStore.token() && !GitHubStore.connected() && GitHubStore.conn.state !== "checking") this.ghCheck("");
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
    $("teamTypesRow").classList.toggle("hidden", this.tab === "github" || this.tab === "shared" || this.tab === "perms" || this.tab === "dict");
    this.draft.types.forEach(t => {
      const b = document.createElement("button"); b.type = "button"; b.className = "seg" + (t === this.type ? " on" : "");
      const n = this.tab === "fields" ? (this.draft.requiredFields[t] || []).length : ((this.draft.templates[t] || {}).headings || []).length;
      b.textContent = t + (n ? " (" + n + ")" : "");
      b.onclick = () => { this.type = t; this.render(); };
      types.appendChild(b);
    });
    this.status();
    this.ghUi();
    const body = $("teamBody"); body.innerHTML = "";
    if (this.tab === "fields") this.renderFields(body);
    else if (this.tab === "template") this.renderTemplate(body);
    else if (this.tab === "shared") this.renderShared(body);
    else if (this.tab === "perms") this.renderPerms(body);
    else if (this.tab === "dict") this.renderDict(body);
    else this.renderGithub(body);
  },

  /* ---------- Shared Services table (breakdown: each one picked = its own User Story) ---------- */
  renderShared(body) {
    const list = this.draft.sharedServices = normalizeSharedServices(this.draft.sharedServices);
    const intro = document.createElement("p"); intro.className = "muted";
    intro.textContent = "השירותים שמופיעים בשאלה \"האם נדרשים Shared Services?\" בפירוק פיצ'ר. לכל שירות שנבחר נפתח User Story ייעודי, אף פעם לא Task. Tasks: שורה לכל Task (ריק = אפיון וביצוע). Leading Squad: אם מולא, ה-US של השירות יקבל אותו במקום ה-Squad של הפיצ'ר.";
    const bar = document.createElement("div"); bar.className = "tbar";
    const add = document.createElement("button"); add.type = "button"; add.className = "btn ghost"; add.textContent = "+ שירות";
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "btn ghost"; reset.textContent = "איפוס לברירת המחדל";
    const sp = document.createElement("span"); sp.className = "sp";
    bar.append(add, sp, reset);
    const dl = document.createElement("datalist"); dl.id = "svcSquads";
    Meta.typeMeta("User Story").then(m => { const f = m.byRef.get("Custom.LeadingSquad"); (f && f.allowed || []).forEach(v => dl.appendChild(new Option(v, v))); }).catch(() => {});
    const tbl = document.createElement("table"); tbl.className = "ttable svctable";
    tbl.innerHTML = "<thead><tr><th>שירות</th><th>עדיפות</th><th>Leading Squad</th><th>Tasks (שורה לכל Task)</th><th>פעיל</th><th></th></tr></thead>";
    const tb = document.createElement("tbody"); tbl.appendChild(tb);
    const draw = () => {
      tb.innerHTML = "";
      list.forEach((x, i) => {
        const tr = document.createElement("tr");
        const name = document.createElement("input"); name.value = x.name; name.setAttribute("aria-label", "שם השירות"); name.placeholder = "למשל DBA";
        name.oninput = () => { x.name = name.value.trim(); this.markDirty(); };
        const pr = document.createElement("select"); pr.setAttribute("aria-label", "עדיפות של " + (x.name || "השירות"));
        [1, 2, 3, 4].forEach(n => pr.add(new Option(String(n), String(n)))); pr.value = String(x.priority);
        pr.onchange = () => { x.priority = Number(pr.value); this.markDirty(); };
        const sq = document.createElement("input"); sq.value = x.squad; sq.setAttribute("list", "svcSquads"); sq.placeholder = "כמו בפיצ'ר"; sq.setAttribute("aria-label", "Leading Squad של " + (x.name || "השירות"));
        sq.oninput = () => { x.squad = sq.value.trim(); this.markDirty(); };
        const tk = document.createElement("textarea"); tk.rows = Math.max(2, x.tasks.length); tk.value = x.tasks.join("\n"); tk.setAttribute("aria-label", "Tasks של " + (x.name || "השירות"));
        tk.placeholder = "אפיון\nביצוע";
        tk.oninput = () => { x.tasks = tk.value.split("\n").map(t => t.trim()).filter(Boolean); this.markDirty(); };
        const ac = document.createElement("input"); ac.type = "checkbox"; ac.checked = x.active; ac.setAttribute("aria-label", "פעיל: " + (x.name || "השירות"));
        ac.onchange = () => { x.active = ac.checked; this.markDirty(); };
        const del = document.createElement("button"); del.type = "button"; del.className = "btn ghost sm"; del.textContent = "✕"; del.title = "מחיקה"; del.setAttribute("aria-label", "מחיקת " + (x.name || "השירות"));
        del.onclick = () => { list.splice(i, 1); this.markDirty(); draw(); };
        [name, pr, sq, tk, ac, del].forEach(el => { const td = document.createElement("td"); td.appendChild(el); tr.appendChild(td); });
        tb.appendChild(tr);
      });
      if (!list.length) tb.innerHTML = '<tr><td colspan="6" class="muted">אין שירותים. השאלה על Shared Services לא תוצג בפירוק.</td></tr>';
    };
    add.onclick = () => { list.push({name: "", priority: 3, squad: "", tasks: [], active: true}); this.markDirty(); draw(); const i = tb.querySelectorAll("tr"); const last = i[i.length - 1]; if (last) last.querySelector("input").focus(); };
    reset.onclick = () => this.confirmBar("להחזיר את רשימת ה-Shared Services לברירת המחדל?", "איפוס", () => {
      this.draft.sharedServices = normalizeSharedServices(TEAM_DEFAULT.sharedServices); this.markDirty(); this.render();
    });
    body.append(intro, bar, dl, tbl);
    draw();
  },

  /* ---------- Required fields ---------- */
  async renderFields(body) {
    const bar = document.createElement("div"); bar.className = "tbar";
    bar.innerHTML = '<input type="search" id="fieldFilter" placeholder="חיפוש שדה" aria-label="חיפוש שדה"><label class="chk"><input type="checkbox" id="onlyReq"> רק שדות חובה</label><span class="sp"></span><span class="muted" id="reqCount"></span><button type="button" class="btn ghost" id="reqReset">איפוס לברירת המחדל</button>';
    body.appendChild(bar);
    const holder = document.createElement("div"); holder.className = "fieldgroups"; holder.innerHTML = '<div class="muted pad">טוען שדות מ-Azure DevOps...</div>';
    body.appendChild(holder);
    const ff = bar.querySelector("#fieldFilter"), oq = bar.querySelector("#onlyReq");
    ff.value = this.filter; oq.checked = this.onlyRequired;
    const type = this.type;
    bar.querySelector("#reqReset").onclick = () => this.confirmBar("להחזיר את שדות החובה של " + type + " לברירת המחדל?", "איפוס", () => {
      this.draft.requiredFields[type] = (TEAM_DEFAULT.requiredFields[type] || []).slice();
      this.markDirty(); this.render();
    });
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

  /* ---------- Update permissions: my access + the exceptions table ---------- */
  renderPerms(body) {
    const p = this.draft.permissions = normalizePermissions(this.draft.permissions);
    const mine = document.createElement("div"); mine.className = "permme"; mine.innerHTML = '<div class="muted">בודק את ההרשאות שלכם...</div>';
    Perm.ready().then(st => {
      const teams = st.teams.length ? st.teams.map(t => escHtml(t.name)).join(", ") : "לא נמצאו";
      mine.innerHTML = "<b>ההרשאות שלכם</b> (" + escHtml(st.email || Auth.userName || "") + ")<br>" +
        "צוותים ב-Azure: " + teams + (st.error ? ' <span class="err-inline">(' + escHtml(st.error) + ")</span>" : "") + "<br>" +
        "מותר לעדכן: " + escHtml(Perm.summary()) + (p.mode === "off" ? " <b>(הבדיקה כבויה, כולם יכולים לעדכן הכל)</b>" : "");
    }).catch(e => { mine.textContent = "בדיקת ההרשאות נכשלה: " + (e.message || e); });
    const intro = document.createElement("div"); intro.className = "muted permintro";
    intro.innerHTML = "<p>אפשר לעדכן וליצור פריט כשלפחות אחד מהם שלכם: <b>Area Path</b> של צוות Azure שאתם חברים בו (כולל מה שמתחתיו), או <b>Leading Squad</b> שלכם. צוות Azure ששמו כשם סקוואד נותן את הסקוואד הזה.</p>" +
      "<p>בטבלה מוסיפים רק <b>חריגים</b>: סקוואדים או Areas נוספים, <b>מנהל</b> (מעדכן הכל ושומר הגדרות) או <b>קריאה בלבד</b>. כשיש לפחות מנהל אחד, רק מנהלים יכולים לשמור הגדרות.</p>" +
      "<p>⚠ הטבלה נשמרת בקובץ team-config.json, שגלוי לכל מי שיש לו את כתובת האתר. זו בדיקה בתוך אז'ורי בלבד: באתר של Azure DevOps ההרשאות לא משתנות.</p>";
    const modeRow = document.createElement("div"); modeRow.className = "tbar";
    const ml = document.createElement("label"); ml.className = "chk"; ml.textContent = "בדיקת הרשאות: ";
    const mode = document.createElement("select"); mode.id = "permMode";
    mode.add(new Option("פעילה: חוסמת עדכון של פריטים לא שלכם", "block")); mode.add(new Option("כבויה: כולם מעדכנים הכל", "off"));
    mode.value = p.mode; mode.onchange = () => { p.mode = mode.value; this.markDirty(); };
    ml.appendChild(mode);
    const add = document.createElement("button"); add.type = "button"; add.className = "btn ghost"; add.textContent = "+ משתמש";
    const sp = document.createElement("span"); sp.className = "sp";
    const cnt = document.createElement("span"); cnt.className = "muted";
    modeRow.append(ml, sp, cnt, add);
    // one Area Path per row: rows saved with several areas (older format) are split
    const split = [];
    p.users.forEach(u => { if (u.areas.length > 1) u.areas.forEach(a => split.push(Object.assign({}, u, {squads: u.squads.slice(), areas: [a]}))); else split.push(u); });
    p.users.splice(0, p.users.length, ...split);
    const squadOpts = async () => { const m = await Meta.typeMeta("User Story"); const f = m.byRef.get(PERM_SQUAD); return ((f && f.allowed) || []).map(v => ({value: v, label: v})); };
    const lastPart = v => String(v).split("\\").pop();
    const roleNames = {user: "רגיל", admin: "מנהל", readonly: "קריאה בלבד"};
    const tbl = document.createElement("table"); tbl.className = "ttable permtable";
    const thead = document.createElement("thead");
    thead.innerHTML = "<tr><th>משתמש (מ-Azure)</th><th>תפקיד</th><th>סקוואדים נוספים</th><th>Area Path נוסף</th><th>הערה</th><th></th></tr>";
    // filters under the headings
    const flt = this.permFilter = this.permFilter || {who: "", role: "", squad: "", area: "", note: ""};
    const fr = document.createElement("tr"); fr.className = "pfilter";
    const fIn = (k, ph) => { const i = document.createElement("input"); i.type = "search"; i.placeholder = ph; i.value = flt[k]; i.setAttribute("aria-label", "סינון: " + ph); i.oninput = () => { flt[k] = i.value; applyFilter(); }; return i; };
    const fSel = (k, label) => { const s2 = document.createElement("select"); s2.setAttribute("aria-label", "סינון לפי " + label); s2.dataset.f = k; s2.onchange = () => { flt[k] = s2.value; applyFilter(); }; return s2; };
    const fRole = fSel("role", "תפקיד"), fSq = fSel("squad", "סקוואד"), fAr = fSel("area", "Area Path");
    [fIn("who", "חיפוש שם או מייל"), fRole, fSq, fAr, fIn("note", "חיפוש בהערה")].forEach(x => { const th = document.createElement("th"); th.appendChild(x); fr.appendChild(th); });
    const thx = document.createElement("th"); const clr = document.createElement("button"); clr.type = "button"; clr.className = "btn ghost mini"; clr.textContent = "ניקוי"; clr.title = "ניקוי הסינון";
    clr.onclick = () => { Object.keys(flt).forEach(k => flt[k] = ""); fr.querySelectorAll("input").forEach(i => i.value = ""); fillFilters(); applyFilter(); };
    thx.appendChild(clr); fr.appendChild(thx); thead.appendChild(fr);
    const fillFilters = () => {
      const opt = (sel, all, values, label) => { sel.innerHTML = ""; sel.add(new Option(all, "")); values.forEach(v => sel.add(new Option(label ? label(v) : v, v))); sel.value = values.includes(flt[sel.dataset.f]) ? flt[sel.dataset.f] : ""; flt[sel.dataset.f] = sel.value; };
      opt(fRole, "כל התפקידים", Object.keys(roleNames), v => roleNames[v]);
      opt(fSq, "כל הסקוואדים", [...new Set(p.users.flatMap(u => u.squads))].sort());
      opt(fAr, "כל ה-Areas", [...new Set(p.users.flatMap(u => u.areas))].sort(), lastPart);
    };
    const tb = document.createElement("tbody"); tbl.append(thead, tb);
    const match = u => (!flt.who || norm(u.email + " " + (u.name || "")).includes(norm(flt.who))) && (!flt.role || u.role === flt.role) &&
      (!flt.squad || u.squads.includes(flt.squad)) && (!flt.area || u.areas.includes(flt.area)) && (!flt.note || norm(u.note || "").includes(norm(flt.note)));
    const applyFilter = () => {
      let n = 0;
      tb.querySelectorAll("tr[data-i]").forEach(tr => { const ok = match(p.users[+tr.dataset.i]); tr.classList.toggle("hidden", !ok); if (ok) n++; });
      const any = Object.values(flt).some(Boolean);
      cnt.textContent = any ? "מוצגות " + n + " מתוך " + p.users.length + " שורות" : p.users.length ? p.users.length + " שורות" : "";
    };
    const changed = () => { this.markDirty(); fillFilters(); applyFilter(); };
    const draw = () => {
      tb.innerHTML = "";
      if (!p.users.length) { tb.innerHTML = '<tr><td colspan="6" class="muted">אין חריגים. כולם מקבלים הרשאות לפי הצוותים שלהם ב-Azure.</td></tr>'; fillFilters(); applyFilter(); return; }
      p.users.forEach((u, i) => {
        const tr = document.createElement("tr"); tr.dataset.i = i;
        const who = makePersonPicker({label: "משתמש", azureRequired: true}, u.email ? (u.name ? u.name + " <" + u.email + ">" : u.email) : null, () => {
          const v = who.get(); if (!v) return;
          const m = String(v).match(/^(.*?)\s*<([^>]+)>\s*$/);
          u.email = (m ? m[2] : String(v)).trim().toLowerCase(); u.name = m ? m[1].trim() : "";
          changed();
        });
        const ro = document.createElement("select"); ro.setAttribute("aria-label", "תפקיד של " + (u.name || u.email || "המשתמש"));
        Object.entries(roleNames).forEach(([v, l]) => ro.add(new Option(l, v))); ro.value = u.role;
        ro.onchange = () => { u.role = ro.value; changed(); };
        const sq = makeMultiPicker({label: "סקוואדים נוספים של " + (u.name || u.email || "המשתמש"), placeholder: "בחירת סקוואדים", value: u.squads, load: squadOpts,
          onChange: v => { u.squads = v; changed(); }});
        const ar = makeMultiPicker({label: "Area Path של " + (u.name || u.email || "המשתמש"), placeholder: "בחירת Area Path", value: u.areas, load: () => treeOptions("area"), short: lastPart, tree: true, saveOnClose: true,
          suggest: async () => u.squads.length ? {title: "Areas של " + u.squads.join(", ") + " (לפי הפריטים)", list: await SquadAreas.many(u.squads)} : null,
          onChange: v => {
            // one area per row: more than one opens a row for each, with the same user, role, squads and note
            u.areas = v.slice(0, 1);
            const extra = v.slice(1).map(a => Object.assign({}, u, {squads: u.squads.slice(), areas: [a]}));
            if (extra.length) { p.users.splice(i + 1, 0, ...extra); toast("נפתחו " + extra.length + " שורות נוספות, אחת לכל Area Path"); this.markDirty(); draw(); }
            else changed();
          }});
        const nt = document.createElement("input"); nt.value = u.note || ""; nt.placeholder = "למה"; nt.setAttribute("aria-label", "הערה");
        nt.oninput = () => { u.note = nt.value; this.markDirty(); applyFilter(); };
        const del = mkIconBtn("✕", "מחיקת " + (u.name || u.email || "המשתמש"), false, () => { p.users.splice(i, 1); this.markDirty(); draw(); }, "del");
        [who.el, ro, sq.el, ar.el, nt, del].forEach(x => { const td = document.createElement("td"); td.appendChild(x); tr.appendChild(td); });
        tb.appendChild(tr);
      });
      fillFilters(); applyFilter();
    };
    add.onclick = () => { p.users.push({email: "", name: "", role: "user", squads: [], areas: [], note: ""}); Object.keys(flt).forEach(k => flt[k] = ""); fr.querySelectorAll("input").forEach(x => x.value = ""); this.markDirty(); draw(); const f = tb.querySelector("tr:last-child input"); if (f) f.focus(); };
    draw();
    const lock = document.createElement("p"); lock.className = "muted";
    if (!Perm.canSaveSettings()) lock.innerHTML = "<b>אתם לא מנהלי הרשאות, ולכן לא תוכלו לשמור שינויים בהגדרות.</b>";
    body.append(mine, intro, modeRow, tbl, lock);
  },

  /* ---------- Dictionary for questions: synonyms and Hebrew squad names ---------- */
  renderDict(body) {
    const list = this.draft.dictionary = normalizeDictionary(this.draft.dictionary);
    const intro = document.createElement("div"); intro.className = "muted permintro";
    intro.innerHTML = "<p>המילון עוזר לאז'ורי להבין שאלות חופשיות.</p>" +
      "<p><b>מילים נרדפות</b>: שאלה על אחת המילים מחפשת את כולן בכותרת וב-Description. למשל: ממשק, API, Interface, אינטגרציה.</p>" +
      "<p><b>שם עברי לסקוואד</b>: שאלה \"באגים של לוגיסטיקה\" תבין שמדובר בסקוואד Logistics.</p>" +
      "<p>משתמשים שולחים בקשה להוספה מתוך תשובה לשאלה (כפתור \"בקשה להוסיף מילה נרדפת\"). רק מנהלים שומרים שינויים.</p>";
    const bar = document.createElement("div"); bar.className = "tbar";
    const add = document.createElement("button"); add.type = "button"; add.className = "btn ghost"; add.textContent = "+ שורה";
    const reset = document.createElement("button"); reset.type = "button"; reset.className = "btn ghost"; reset.textContent = "איפוס לברירת המחדל";
    const sp = document.createElement("span"); sp.className = "sp";
    bar.append(add, sp, reset);
    const dl = document.createElement("datalist"); dl.id = "dictSquads";
    Meta.typeMeta("User Story").then(m => { const f = m.byRef.get(PERM_SQUAD); (f && f.allowed || []).forEach(v => dl.appendChild(new Option(v, v))); }).catch(() => {});
    const tbl = document.createElement("table"); tbl.className = "ttable permtable dicttable";
    tbl.innerHTML = "<thead><tr><th>סוג</th><th>סקוואד (לשם עברי)</th><th>מילים (מופרדות בפסיק)</th><th></th></tr></thead>";
    const tb = document.createElement("tbody"); tbl.appendChild(tb);
    const draw = () => {
      tb.innerHTML = "";
      list.forEach((x, i) => {
        const tr = document.createElement("tr");
        const kind = document.createElement("select"); kind.setAttribute("aria-label", "סוג שורה " + (i + 1));
        kind.add(new Option("מילים נרדפות", "words")); kind.add(new Option("שם עברי לסקוואד", "squad")); kind.value = x.kind;
        const tg = document.createElement("input"); tg.value = x.target; tg.setAttribute("list", "dictSquads"); tg.placeholder = "למשל Logistics"; tg.setAttribute("aria-label", "סקוואד שורה " + (i + 1));
        tg.disabled = x.kind !== "squad";
        kind.onchange = () => { x.kind = kind.value; tg.disabled = x.kind !== "squad"; this.markDirty(); };
        tg.oninput = () => { x.target = tg.value.trim(); this.markDirty(); };
        const ws = document.createElement("input"); ws.value = x.words.join(", "); ws.placeholder = "ממשק, API, אינטגרציה"; ws.setAttribute("aria-label", "מילים שורה " + (i + 1));
        ws.oninput = () => { x.words = ws.value.split(/[,،]/).map(w => w.trim()).filter(Boolean); this.markDirty(); };
        const del = mkIconBtn("✕", "מחיקת שורה " + (i + 1), false, () => { list.splice(i, 1); this.markDirty(); draw(); }, "del");
        [kind, tg, ws, del].forEach(el => { const td = document.createElement("td"); td.appendChild(el); tr.appendChild(td); });
        tb.appendChild(tr);
      });
    };
    add.onclick = () => { list.push({kind: "words", target: "", words: []}); this.markDirty(); draw(); const f = tb.querySelector("tr:last-child input:not([disabled])"); if (f) f.focus(); };
    reset.onclick = () => this.confirmBar("להחזיר את המילון לברירת המחדל?", "איפוס", () => { this.draft.dictionary = normalizeDictionary(ASK_DICT_DEFAULT); this.markDirty(); this.render(); });
    draw();
    body.append(intro, bar, dl, tbl);
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
      '<p class="muted">ה-token נשמר רק בלשונית הזו ונמחק כשסוגרים אותה.</p>' +
      '<div class="tbar"><button class="btn" type="button" id="ghSave">בדיקת חיבור</button>' + (has ? '<button class="btn ghost" type="button" id="ghClear">הסרת token</button>' : "") + '<span class="muted" id="ghMsg">' + (has ? "יש token שמור" : "אין token") + "</span></div>" +
      '<p class="muted">רק מי שיש לו token כזה יכול לשמור הגדרות לצוות. כל השאר רואים את ההגדרות ופועלים לפיהן.</p></div>';
    $("ghSave").onclick = () => this.ghCheck($("ghTok").value.trim());
    $("ghTok").oninput = () => this.ghUi();
    if ($("ghClear")) $("ghClear").onclick = () => { GitHubStore.setToken(""); GitHubStore.conn = {state: "none", repo: "", error: "", token: ""}; this.render(); };
    this.ghUi();
  },

  /* ---------- Save ---------- */
  prepared() {
    const d = JSON.parse(JSON.stringify(this.draft));
    Object.keys(d.templates).forEach(t => {
      const tp = d.templates[t];
      tp.headings = (tp.headings || []).filter(h => String(h.text || "").trim()).map(h => ({text: h.text.trim(), required: !!h.required, content: sanitizeTemplateHtml(h.content || ""), aliases: (h.aliases || []).filter(Boolean)}));
      if (!tp.headings.length) delete d.templates[t];
    });
    d.sharedServices = normalizeSharedServices(d.sharedServices);
    d.permissions = normalizePermissions(d.permissions);
    d.dictionary = normalizeDictionary(d.dictionary);
    d.updatedAt = new Date().toISOString();
    d.updatedBy = Auth.userName || "";
    return d;
  },
  async save(force) {
    if (!Perm.canSaveSettings()) { toast("רק מנהלי ההרשאות שבטבלת ההרשאות יכולים לשמור הגדרות לצוות."); return; }
    if (!GitHubStore.connected()) { this.ghUi(); $("ghBarTok").focus(); toast("כדי לשמור לצוות צריך קודם לחבר GitHub token (בשורה למעלה)"); return; }
    const d = this.prepared();
    const btn = $("teamSave"); btn.disabled = true; btn.textContent = "שומר...";
    try {
      await GitHubStore.save(d, TeamConfig.data.updatedAt, force);
      TeamConfig.data = TeamConfig.normalize(d); TeamConfig.source = "site";
      Perm.reset(); Perm.ready().catch(() => {});
      this.draft = TeamConfig.clone(); this.dirty = false; this.render();
      toast("נשמר ב-GitHub. כל הצוות יקבל את ההגדרות תוך כדקה");
    } catch (e) {
      if (e.conflict) this.confirmBar(e.message + " לשמור בכל זאת ולדרוס?", "לשמור ולדרוס", () => this.save(true));
      else toast("השמירה נכשלה: " + e.message);
    } finally { btn.textContent = "שמירה לצוות"; this.ghUi(); }
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
    $("teamBtn").onclick = () => { closeSetMenu(); this.open(); };
    $("teamClose").onclick = () => this.close();
    $("teamSave").onclick = () => this.save(false);
    this.ghInit();
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
