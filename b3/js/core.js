"use strict";

/* ============================ CONFIG ============================ */
const CONFIG = {
  VERSION: "2.0-beta.3",
  ORG: "GOI-Finance",
  TENANT: "GOIFinance.onmicrosoft.com",
  // Fill in after registering the app in Microsoft Entra ID (App registrations).
  // Leave empty to show only the token login.
  CLIENT_ID: "",
  DEFAULT_FIELDS: ["ID","Type","Title","State","Assigned To","Iteration","Area","Priority","WSJF Priority","Description","Attachments"],
  MAX_IDS: 500,
  MAX_IMAGES_PER_ROW_XLSX: 10
};
const ADO_SCOPE = "499b84ac-1321-427f-aa17-267ca6975798/user_impersonation";
const ADO = "https://dev.azure.com/" + encodeURIComponent(CONFIG.ORG);

/* ============================ FIELDS ============================ */
// kind: text | person | date | last (last path segment) | html | desc | bool
const FIELDS = [
  {name:"ID",                  ref:"id",                                      kind:"id",     aliases:["id","מספר","מזהה"]},
  {name:"Type",                ref:"System.WorkItemType",                     kind:"text",   aliases:["type","סוג"]},
  {name:"Title",               ref:"System.Title",                            kind:"text",   aliases:["title","כותרת","שם"]},
  {name:"State",               ref:"System.State",                            kind:"text",   aliases:["state","status","סטטוס","מצב"]},
  {name:"Reason",              ref:"System.Reason",                           kind:"text",   aliases:["reason","סיבה"]},
  {name:"Assigned To",         ref:"System.AssignedTo",                       kind:"person", aliases:["assignedto","assigned","אחראי","משויך","משויךל"]},
  {name:"Created By",          ref:"System.CreatedBy",                        kind:"person", aliases:["createdby","נוצרעי","יוצר"]},
  {name:"Created Date",        ref:"System.CreatedDate",                      kind:"date",   aliases:["createddate","created","תאריךיצירה"]},
  {name:"Changed Date",        ref:"System.ChangedDate",                      kind:"date",   aliases:["changeddate","changed","תאריךעדכון","עודכן"]},
  {name:"Iteration",           ref:"System.IterationPath",                    kind:"last",   aliases:["iteration","iterationpath","sprint","ספרינט","איטרציה"]},
  {name:"Area",                ref:"System.AreaPath",                         kind:"last",   aliases:["area","areapath","אזור"]},
  {name:"Project",             ref:"System.TeamProject",                      kind:"text",   aliases:["project","teamproject","פרויקט"]},
  {name:"Priority",            ref:"Microsoft.VSTS.Common.Priority",          kind:"text",   aliases:["priority","עדיפות"]},
  {name:"WSJF Priority",       ref:"Custom.WSJFPriority",                     kind:"text",   aliases:["wsjfpriority","wsjf"]},
  {name:"Severity",            ref:"Microsoft.VSTS.Common.Severity",          kind:"text",   aliases:["severity","חומרה"]},
  {name:"Tags",                ref:"System.Tags",                             kind:"text",   aliases:["tags","tag","תגיות","תגית"]},
  {name:"Description",         ref:"System.Description",                      kind:"desc",   aliases:["description","desc","תיאור"]},
  {name:"Repro Steps",         ref:"Microsoft.VSTS.TCM.ReproSteps",           kind:"html",   aliases:["reprosteps","repro","צעדיםלשחזור"]},
  {name:"Acceptance Criteria", ref:"Microsoft.VSTS.Common.AcceptanceCriteria",kind:"html",   aliases:["acceptancecriteria","ac","קריטריוניקבלה","קריטריונים"]},
  {name:"Story Points",        ref:"Microsoft.VSTS.Scheduling.StoryPoints",   kind:"text",   aliases:["storypoints","sp","נקודות"]},
  {name:"Effort",              ref:"Microsoft.VSTS.Scheduling.Effort",        kind:"text",   aliases:["effort","מאמץ"]},
  {name:"Remaining Work",      ref:"Microsoft.VSTS.Scheduling.RemainingWork", kind:"text",   aliases:["remainingwork","remaining","עבודהשנותרה"]},
  {name:"Parent",              ref:"System.Parent",                           kind:"text",   aliases:["parent","אב","הורה"]},
  {name:"Customer",            ref:"Custom.Customer",                         kind:"text",   aliases:["customer","לקוח"]},
  {name:"Leading Squad",       ref:"Custom.LeadingSquad",                     kind:"text",   aliases:["leadingsquad","squad","סקוואד"]},
  {name:"Found In Environment",ref:"Custom.FoundInEnviroment1",               kind:"text",   aliases:["foundinenvironment","environment","env","סביבה"]},
  {name:"Comment Count",       ref:"System.CommentCount",                     kind:"text",   aliases:["commentcount","comments","תגובות"]},
  {name:"Attachments",         ref:"__attachments",                           kind:"attach", aliases:["attachments","attachment","קבציםמצורפים","קבצים","מצורפים","תמונות","images"]}
];
const norm = s => String(s).toLowerCase().replace(/[\s\-_.'"״׳]/g, "");
const FIELD_BY_ALIAS = new Map();
FIELDS.forEach(f => { FIELD_BY_ALIAS.set(norm(f.name), f); f.aliases.forEach(a => FIELD_BY_ALIAS.set(norm(a), f)); });

/* ============================ PARSING ============================ */
const KW = {
  only:   ["רק","only"],
  remove: ["בלי","ללא","without","remove","חוץמ","להוריד","תוריד","הורד"],
  add:    ["תוסיף","הוסף","להוסיף","תוסיפי","add","plus","עם"]
};
const KW_ALL = [...KW.only, ...KW.remove, ...KW.add];
const KW_RE = new RegExp("(?:^|\\s)(" + KW_ALL.join("|") + ")(?=\\s|$)", "gi");

function parseRequest(text) {
  const t = text.trim();
  const low = norm(t);
  if (["עזרה","help","?","מהאפשר","איךמשתמשים"].includes(low)) return {cmd:"help"};
  if (["נקה","ניקוי","clear","cls"].includes(low)) return {cmd:"clear"};

  const ids = [];
  (t.match(/\d{3,}/g) || []).forEach(n => { const v = parseInt(n, 10); if (!ids.includes(v)) ids.push(v); });
  const rest = t.replace(/\d{3,}/g, " ").replace(/[#,;]+/g, " ").replace(/\s+/g, " ").trim();

  // Split the remainder into keyword segments: [{kw, text}]
  const segs = [];
  let m, last = null, lastEnd = 0;
  KW_RE.lastIndex = 0;
  while ((m = KW_RE.exec(rest))) {
    if (last) segs.push({kw:last, text:rest.slice(lastEnd, m.index)});
    last = m[1].toLowerCase(); lastEnd = m.index + m[0].length;
  }
  if (last) segs.push({kw:last, text:rest.slice(lastEnd)});

  let fields = getDefaultFields();
  const ops = [];
  for (const s of segs) {
    const names = splitFieldNames(s.text);
    if (!names.length) continue;
    const kind = KW.only.includes(s.kw) ? "only" : KW.remove.includes(s.kw) ? "remove" : "add";
    ops.push({kind, names});
  }
  for (const op of ops) {
    if (op.kind === "only") fields = op.names.slice();
    else if (op.kind === "add") op.names.forEach(n => { if (!fields.some(f => sameField(f, n))) fields.push(n); });
    else fields = fields.filter(f => !op.names.some(n => sameField(f, n)));
  }
  fields = fields.filter(f => !sameField(f, "ID"));
  fields.unshift("ID");
  return {cmd:"fetch", ids, fields, customized: ops.length > 0};
}

function splitFieldNames(s) {
  return s
    .replace(/(^|\s)ו-?(?=\S)/g, ",")      // Hebrew "and" prefix: "ו-State", "ותיאור"
    .replace(/\s+(and|&)\s+/gi, ",")
    .split(/[,،\/|+]+/)
    .map(x => x.replace(/^[\s:.\-]+|[\s:.\-?!]+$/g, "").replace(/^(השדות?|שדות?|fields?)\s+/i, "").trim())
    .filter(Boolean);
}
function resolveKnown(name) { return FIELD_BY_ALIAS.get(norm(name)) || null; }
function sameField(a, b) {
  const fa = resolveKnown(a), fb = resolveKnown(b);
  return fa && fb ? fa === fb : norm(a) === norm(b);
}

/* ============================ AUTH ============================ */
const Auth = {
  mode: null,          // "msal" | "pat" | "demo"
  msal: null, account: null, pat: null, userName: "", userEmail: "",

  redirectUri() { return location.origin + location.pathname.replace(/index\.html?$/i, ""); },

  async init() {
    if (CONFIG.CLIENT_ID && window.msal) {
      this.msal = new msal.PublicClientApplication({
        auth: {clientId: CONFIG.CLIENT_ID, authority: "https://login.microsoftonline.com/" + CONFIG.TENANT, redirectUri: this.redirectUri()},
        cache: {cacheLocation: "sessionStorage"}
      });
      const res = await this.msal.handleRedirectPromise();
      const acct = (res && res.account) || this.msal.getAllAccounts()[0];
      if (acct) { this.mode = "msal"; this.account = acct; this.userName = acct.name || acct.username; return true; }
    }
    for (const store of [sessionStorage, localStorage]) {
      const pat = store.getItem("ado_pat");
      if (pat) { this.mode = "pat"; this.pat = pat; this.userName = store.getItem("ado_user") || ""; this.userEmail = store.getItem("ado_email") || ""; return true; }
    }
    if (sessionStorage.getItem("ado_demo")) { this.mode = "demo"; this.userName = "משתמש הדגמה"; this.userEmail = "demo.user@example.com"; return true; }
    return false;
  },

  async loginMicrosoft() { await this.msal.loginRedirect({scopes: [ADO_SCOPE], prompt: "select_account"}); },

  async loginPat(pat, remember) {
    this.mode = "pat"; this.pat = pat.trim();
    await api(ADO + "/_apis/projects?$top=1&api-version=7.1");   // validates the token
    try {
      const cd = await api(ADO + "/_apis/connectionData");
      const u = cd.authenticatedUser || {};
      this.userName = u.providerDisplayName || u.customDisplayName || "";
      this.userEmail = (u.properties && u.properties.Account && (u.properties.Account.$value || u.properties.Account)) || "";
      if (typeof this.userEmail !== "string") this.userEmail = "";
    } catch (e) { this.userName = ""; this.userEmail = ""; }
    const store = remember ? localStorage : sessionStorage;
    store.setItem("ado_pat", this.pat);
    store.setItem("ado_user", this.userName);
    store.setItem("ado_email", this.userEmail);
  },

  async header() {
    if (this.mode === "pat") return "Basic " + btoa(":" + this.pat);
    if (this.mode === "msal") {
      try {
        const r = await this.msal.acquireTokenSilent({scopes: [ADO_SCOPE], account: this.account});
        return "Bearer " + r.accessToken;
      } catch (e) {
        await this.msal.acquireTokenRedirect({scopes: [ADO_SCOPE], account: this.account});
        throw new AuthError("נדרשת התחברות מחדש");
      }
    }
    throw new AuthError("לא מחובר");
  },

  async logout() {
    [sessionStorage, localStorage].forEach(s => { s.removeItem("ado_pat"); s.removeItem("ado_user"); s.removeItem("ado_email"); s.removeItem("ado_demo"); });
    if (this.mode === "msal" && this.msal) {
      await this.msal.logoutRedirect({account: this.account, onRedirectNavigate: () => false});
    }
    this.mode = null; this.pat = null; this.account = null; this.userEmail = "";
  }
};

class AuthError extends Error {}

async function api(url) {
  let r;
  try {
    r = await fetch(url, {headers: {Authorization: await Auth.header(), Accept: "application/json"}, credentials: "omit"});
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw new Error("אין חיבור ל-Azure DevOps. בדקו את חיבור הרשת או ה-VPN.");
  }
  const ct = r.headers.get("content-type") || "";
  if (r.status === 401 || r.status === 203 || (r.ok && !ct.includes("json"))) {
    throw new AuthError(Auth.mode === "pat" ? "הטוקן לא תקין, פג תוקפו, או שאין לו הרשאת Work Items." : "ההתחברות פגה. התחברו מחדש.");
  }
  if (r.status === 403) throw new Error("אין לכם הרשאה לפריטים האלה.");
  if (!r.ok) {
    let msg = "";
    try { msg = (await r.json()).message || ""; } catch (e) {}
    throw new Error("Azure DevOps החזיר שגיאה " + r.status + (msg ? ": " + msg : ""));
  }
  return r.json();
}

/* ============================ DATA ============================ */
async function fetchItems(ids) {
  if (Auth.mode === "demo") return demoItems(ids);
  const out = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const url = ADO + "/_apis/wit/workitems?ids=" + chunk.join(",") + "&$expand=all&errorPolicy=omit&api-version=7.1";
    const data = await api(url);
    (data.value || []).forEach(v => { if (v) out.push(v); });
  }
  return out;
}

function cleanHtml(html, reg) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const body = doc.body;
  // Collapse source whitespace (HTML treats raw newlines as spaces)
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
  texts.forEach(n => { n.nodeValue = n.nodeValue.replace(/[\s ]+/g, " "); });
  body.querySelectorAll("img").forEach(el => {
    const src = el.getAttribute("src") || "";
    const label = src && reg ? "[תמונה " + reg(src, el.getAttribute("alt") || "") + "]" : "[תמונה]";
    el.replaceWith(doc.createTextNode("\n" + label + "\n"));
  });
  body.querySelectorAll("ol").forEach(ol => [...ol.children].filter(c => c.tagName === "LI").forEach((li, i) => li.prepend((i + 1) + ". ")));
  body.querySelectorAll("ul").forEach(ul => [...ul.children].filter(c => c.tagName === "LI").forEach(li => li.prepend("• ")));
  body.querySelectorAll("br").forEach(el => el.replaceWith(doc.createTextNode("\n")));
  body.querySelectorAll("p,div,li,tr,h1,h2,h3,h4,h5,h6,blockquote,pre,table,ul,ol").forEach(el => { el.prepend("\n"); el.append("\n"); });
  body.querySelectorAll("td,th").forEach(el => el.append(" | "));
  return body.textContent.split("\n").map(s => s.replace(/\s*\|\s*$/, "").replace(/ +/g, " ").trim()).filter(Boolean).join("\n");
}

function pad(n) { return String(n).padStart(2, "0"); }
function fmtDate(v) { const d = new Date(v); return isNaN(d) ? String(v) : pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear(); }

function findCustomRef(name, items) {
  const target = norm(name);
  for (const it of items) for (const key of Object.keys(it.fields || {})) {
    const lastSeg = key.split(".").pop();
    if (norm(key) === target || norm(lastSeg) === target || norm(key.replace(/^Custom\./i, "")) === target) return key;
  }
  return null;
}

function buildTable(fieldNames, items, ids) {
  const cols = fieldNames.map(n => {
    const known = resolveKnown(n);
    if (known) return {label: known.name, ref: known.ref, kind: known.kind, found: true};
    const ref = findCustomRef(n, items);
    return ref ? {label: n, ref, kind: "auto", found: true} : {label: n, ref: null, kind: "none", found: false};
  });
  const byId = new Map(items.map(it => [it.id, it]));
  const rows = ids.map(id => {
    const it = byId.get(id);
    if (!it) return {id, missing: true, cells: cols.map(c => c.ref === "id" ? String(id) : (c.label === "Title" ? "לא נמצא / אין הרשאה" : ""))};
    const f = it.fields || {};
    const images = [];
    const reg = (src, name) => {
      const key = attachmentKey(src);
      let i = images.findIndex(x => x.key === key);
      if (i < 0) { images.push({key, src, name: name || ""}); i = images.length - 1; }
      else if (name && !images[i].name) images[i].name = name;
      return i + 1;
    };
    return {id, missing: false, project: f["System.TeamProject"], type: f["System.WorkItemType"], images, cells: cols.map(c => cellValue(c, it, f, reg))};
  });
  const projects = [...new Set(rows.filter(r => !r.missing).map(r => r.project))];
  return {cols, rows, missing: rows.filter(r => r.missing).map(r => r.id), unknown: cols.filter(c => !c.found).map(c => c.label), projects};
}

const IMG_EXT = /\.(png|jpe?g|gif|bmp|webp|svg|ico|tiff?)$/i;
function attachmentKey(src) {
  const m = String(src).match(/\/attachments\/([0-9a-f-]{36})/i);
  return m ? m[1].toLowerCase() : String(src);
}
function attachmentsOf(it) {
  return (it.relations || []).filter(x => x && x.rel === "AttachedFile" && x.url).map(x => {
    const name = (x.attributes && x.attributes.name) || "קובץ";
    return {name, url: x.url, isImage: IMG_EXT.test(name)};
  });
}
function cellValue(c, it, f, reg) {
  if (c.ref === "id") return String(it.id);
  if (!c.ref) return "לא נמצא";
  let v;
  if (c.kind === "desc") {
    const isBug = /bug/i.test(f["System.WorkItemType"] || "");
    v = isBug ? (f["Microsoft.VSTS.TCM.ReproSteps"] || f["System.Description"]) : f["System.Description"];
    v = cleanHtml(v, reg);
    return v || "—";
  }
  if (c.kind === "attach") {
    const list = attachmentsOf(it);
    if (!list.length) return "—";
    return list.map(a => a.isImage
      ? "[תמונה " + reg(a.url + (a.url.includes("?") ? "&" : "?") + "fileName=" + encodeURIComponent(a.name), a.name) + "] " + a.name
      : "📎 " + a.name).join("\n");
  }
  v = f[c.ref];
  if (v === undefined || v === null || v === "") return "—";
  if (c.kind === "html") return cleanHtml(v, reg) || "—";
  if (c.kind === "person" || (typeof v === "object" && v.displayName)) return v.displayName || "—";
  if (c.kind === "date") return fmtDate(v);
  if (c.kind === "last") return String(v).split("\\").pop();
  if (typeof v === "boolean") return v ? "כן" : "לא";
  if (typeof v === "string" && /<[a-z][\s\S]*>/i.test(v)) return cleanHtml(v, reg) || "—";
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtDate(v);
  return String(v);
}

/* ============================ EXPORT ============================ */
function escHtml(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

/* Image as an embedded JPEG (data URL) sized for pasting into Outlook, Teams, Word or Excel */
async function imageDataUrl(src) {
  const o = await withTimeout(Img.get(src), 30000);
  const bmp = await createImageBitmap(o.blob);
  const s = Math.min(1, 800 / bmp.width, 800 / bmp.height);
  const cw = Math.max(1, Math.round(bmp.width * s)), ch = Math.max(1, Math.round(bmp.height * s));
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const d = Math.min(1, 240 / cw, 180 / ch);
  return {url: cv.toDataURL("image/jpeg", 0.85), w: Math.round(cw * d), h: Math.round(ch * d)};
}
function collectClipImages(t) {
  return Promise.all(t.rows.map(r => Promise.all((r.images || []).map(im => imageDataUrl(im.src).catch(() => null)))));
}

function tableToClipboardHtml(t, pics) {
  const br = '<br style="mso-data-placement:same-cell">';
  let h = '<table border="1" style="border-collapse:collapse;direction:rtl"><tr>' +
    t.cols.map(c => '<th style="background:#e6eff9">' + escHtml(c.label) + "</th>").join("") + "</tr>";
  t.rows.forEach((r, ri) => {
    const rp = (pics && pics[ri]) || [];
    h += "<tr>" + r.cells.map(v => {
      let cell = escHtml(v).split("\n").join(br);
      cell = cell.replace(/\[תמונה (\d+)\]/g, (m, n) => {
        const p = rp[+n - 1];
        return p ? '<img src="' + p.url + '" width="' + p.w + '" height="' + p.h + '" alt="תמונה ' + n + '">' : m;
      });
      return '<td style="vertical-align:top">' + cell + "</td>";
    }).join("") + "</tr>";
  });
  return h + "</table>";
}
function tableToTsv(t) {
  const clean = v => String(v).split("\n").join(" • ").replace(/\t/g, " ");
  return [t.cols.map(c => c.label).join("\t"), ...t.rows.map(r => r.cells.map(clean).join("\t"))].join("\n");
}

async function copyTable(t, btn) {
  const hasImgs = t.rows.some(r => r.images && r.images.length);
  // Start building right away; the clipboard accepts the HTML as a promise, so the click still counts.
  const htmlP = (async () => tableToClipboardHtml(t, hasImgs ? await collectClipImages(t) : null))();
  const text = tableToTsv(t);
  const label = btn ? btn.textContent : "";
  if (btn && hasImgs) { btn.disabled = true; btn.textContent = "מעתיק..."; }
  try {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/html": htmlP.then(h => new Blob([h], {type: "text/html"})),
        "text/plain": new Blob([text], {type: "text/plain"})
      })]);
    } catch (e) {
      const html = await htmlP;
      const div = document.createElement("div");
      div.style.cssText = "position:fixed;left:-9999px;top:0";
      div.innerHTML = html; document.body.appendChild(div);
      const range = document.createRange(); range.selectNodeContents(div);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      const ok = document.execCommand("copy"); sel.removeAllRanges(); div.remove();
      if (!ok) throw e;
    }
    toast(hasImgs ? "הטבלה הועתקה עם התמונות. אפשר להדביק ב-Outlook, Teams, Word או Excel" : "הטבלה הועתקה. אפשר להדביק ב-Excel, Outlook או Teams");
  } catch (e) {
    toast("ההעתקה נכשלה: " + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/* Minimal .xlsx writer (stored zip, no dependencies) */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  for (const [name, content] of files) {
    const nb = enc.encode(name), data = typeof content === "string" ? enc.encode(content) : content, crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
    lh.setUint16(10, 0, true); lh.setUint16(12, 33, true); lh.setUint32(14, crc, true);
    lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nb.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), nb, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, 0, true); ch.setUint16(14, 33, true); ch.setUint32(16, crc, true);
    ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nb.length, true);
    ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), nb);
    offset += 30 + nb.length + data.length;
  }
  const cdSize = central.reduce((s, p) => s + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"});
}
function wellFormed(s) {
  s = String(s);
  if (s.toWellFormed) s = s.toWellFormed();
  else s = s.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD").replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1\uFFFD");
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
}
function xmlEsc(s) { return wellFormed(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
const XLSX_CELL_MAX = 32000;
function colName(i) { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

const LONG_COLS = ["Description","Repro Steps","Acceptance Criteria","Attachments"];
function colWidth(c) { return LONG_COLS.includes(c.label) ? (c.label === "Attachments" ? 40 : 80) : c.label === "Title" ? 45 : c.ref === "id" ? 10 : 16; }

/* rows: [{cells:[text], pics:[{bytes,w,h}|null]}], picCols: number of image columns */
function tableToXlsx(t, rowPics) {
  rowPics = rowPics || [];
  const picCols = Math.max(0, ...rowPics.map(p => (p || []).length));
  const nData = t.cols.length, nCols = nData + picCols;
  const IMG_COL_W = 36, IMG_COL_PX = IMG_COL_W * 7 + 5;
  const widths = t.cols.map(colWidth).concat(Array(picCols).fill(IMG_COL_W));
  const headers = t.cols.map(c => c.label).concat(Array.from({length: picCols}, (_, i) => "תמונה " + (i + 1)));
  const lastCol = colName(nCols - 1);
  const clip = v => { v = String(v); return v.length > XLSX_CELL_MAX ? v.slice(0, XLSX_CELL_MAX) + " …(קוצר)" : v; };

  let rowsXml = '<row r="1">' + headers.map((h, i) => '<c r="' + colName(i) + '1" t="inlineStr" s="1"><is><t>' + xmlEsc(h) + "</t></is></c>").join("") + "</row>";
  const anchors = [], media = [];
  t.rows.forEach((r, ri) => {
    const rn = ri + 2, pics = rowPics[ri] || [];
    let ht = "";
    if (pics.some(Boolean)) {
      let lines = 1;
      r.cells.forEach((v, i) => {
        const per = Math.max(8, widths[i] * 1.1);
        const n = String(v).split("\n").reduce((s, l) => s + Math.max(1, Math.ceil(l.length / per)), 0);
        lines = Math.max(lines, n);
      });
      const textPt = lines * 15 + 4;
      const imgPt = Math.max(...pics.map(p => p ? p.h : 0)) * 0.75 + 10;
      ht = ' ht="' + Math.min(409, Math.max(textPt, imgPt)).toFixed(1) + '" customHeight="1"';
    }
    let cellsXml = r.cells.map((v, i) => {
      const ref = colName(i) + rn;
      if (t.cols[i].ref === "id" && /^\d+$/.test(v)) return '<c r="' + ref + '" s="2"><v>' + v + "</v></c>";
      return '<c r="' + ref + '" t="inlineStr" s="2"><is><t xml:space="preserve">' + xmlEsc(clip(v)) + "</t></is></c>";
    }).join("");
    pics.forEach((p, k) => {
      if (!p) {
        cellsXml += '<c r="' + colName(nData + k) + rn + '" t="inlineStr" s="2"><is><t>לא נטענה</t></is></c>';
        return;
      }
      media.push(p.bytes);
      const n = media.length;
      const cx = Math.round(p.w * 9525), cy = Math.round(p.h * 9525);
      anchors.push('<xdr:oneCellAnchor><xdr:from><xdr:col>' + (nData + k) + '</xdr:col><xdr:colOff>47625</xdr:colOff><xdr:row>' + (rn - 1) + '</xdr:row><xdr:rowOff>47625</xdr:rowOff></xdr:from>' +
        '<xdr:ext cx="' + cx + '" cy="' + cy + '"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="' + (n + 1) + '" name="Picture ' + n + '" descr="' + xmlEsc(p.name || ("תמונה " + (k + 1))) + '"/>' +
        '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rId' + n + '"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>' +
        '<xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>');
    });
    rowsXml += '<row r="' + rn + '"' + ht + ">" + cellsXml + "</row>";
  });
  const hasDrawing = anchors.length > 0;
  const sheet = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<dimension ref="A1:' + lastCol + (t.rows.length + 1) + '"/>' +
    '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    "<cols>" + widths.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join("") + "</cols>" +
    "<sheetData>" + rowsXml + "</sheetData>" +
    '<autoFilter ref="A1:' + lastCol + (t.rows.length + 1) + '"/>' +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    (hasDrawing ? '<drawing r:id="rId1"/>' : "") +
    "</worksheet>";
  const styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE6EFF9"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="top" wrapText="1"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>' +
    "</styleSheet>";
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  const files = [
    ["[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
      (media.length ? '<Default Extension="png" ContentType="image/png"/>' : "") +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      (hasDrawing ? '<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>' : "") +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'],
    ["_rels/.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'],
    ["docProps/core.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Work Items</dc:title><dc:creator>Azure Chat</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">' + now + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + now + "</dcterms:modified></cp:coreProperties>"],
    ["docProps/app.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>'],
    ["xl/workbook.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="12300"/></bookViews>' +
      '<sheets><sheet name="Work Items" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'Work Items\'!$A$1:$' + lastCol + "$" + (t.rows.length + 1) + "</definedName></definedNames></workbook>"],
    ["xl/_rels/workbook.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ["xl/worksheets/sheet1.xml", sheet],
    ["xl/styles.xml", styles]
  ];
  if (hasDrawing) {
    files.push(["xl/worksheets/_rels/sheet1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>']);
    files.push(["xl/drawings/drawing1.xml", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' + anchors.join("") + "</xdr:wsDr>"]);
    files.push(["xl/drawings/_rels/drawing1.xml.rels", '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      media.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image' + (i + 1) + '.png"/>').join("") + "</Relationships>"]);
    media.forEach((b, i) => files.push(["xl/media/image" + (i + 1) + ".png", b]));
  }
  return zipStore(files);
}

/* Converts any loaded image to PNG bytes plus a display size that fits an Excel cell */
async function imageToPng(blob, maxW, maxH) {
  const bmp = await createImageBitmap(blob);
  const scaleStore = Math.min(1, 1600 / bmp.width, 1600 / bmp.height);
  const cw = Math.max(1, Math.round(bmp.width * scaleStore)), ch = Math.max(1, Math.round(bmp.height * scaleStore));
  const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cw, ch); ctx.drawImage(bmp, 0, 0, cw, ch);
  if (bmp.close) bmp.close();
  const png = await new Promise((res, rej) => cv.toBlob(b => b ? res(b) : rej(new Error("png")), "image/png"));
  const s = Math.min(1, maxW / cw, maxH / ch);
  return {bytes: new Uint8Array(await png.arrayBuffer()), w: Math.round(cw * s), h: Math.round(ch * s)};
}
function withTimeout(p, ms) { return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]); }

async function collectRowPics(t) {
  const cap = CONFIG.MAX_IMAGES_PER_ROW_XLSX;
  return Promise.all(t.rows.map(r => Promise.all((r.images || []).slice(0, cap).map(async im => {
    try {
      const o = await withTimeout(Img.get(im.src), 30000);
      const p = await imageToPng(o.blob, 245, 180);
      p.name = im.name; return p;
    } catch (e) { return null; }
  }))));
}

function xlsxFileName() {
  const d = new Date();
  return "work-items-" + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + "-" + pad(d.getHours()) + pad(d.getMinutes()) + ".xlsx";
}
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

async function downloadXlsx(t, btn) {
  const name = xlsxFileName();
  // Ask for the save location first, while the click still counts as a user action.
  let handle = null;
  if (window.showSaveFilePicker) {
    try {
      handle = await window.showSaveFilePicker({suggestedName: name, types: [{description: "Excel", accept: {[XLSX_MIME]: [".xlsx"]}}]});
    } catch (e) {
      if (e && e.name === "AbortError") return;      // user cancelled
      handle = null;                                  // picker not allowed here: fall back to a normal download
    }
  }
  const label = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "מכין קובץ..."; }
  try {
    const pics = await collectRowPics(t);
    const blob = tableToXlsx(t, pics);
    const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
    if (blob.size < 100 || head[0] !== 0x50 || head[1] !== 0x4B) throw new Error("הקובץ שנוצר לא תקין");
    if (handle) {
      const w = await handle.createWritable(); await w.write(blob); await w.close();
      toast("הקובץ נשמר: " + handle.name);
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      // Keep the link alive so a "Save as" dialog can finish before the data is released.
      setTimeout(() => URL.revokeObjectURL(a.href), 10 * 60 * 1000);
    }
    const missing = pics.flat().filter(x => x === null).length;
    if (missing) toast(missing + " תמונות לא נטענו ולכן לא נכנסו לקובץ");
  } catch (e) {
    toast("יצירת הקובץ נכשלה: " + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = label; }
  }
}

/* ============================ IMAGES ============================ */
const Img = {
  cache: new Map(), queue: [], active: 0, LIMIT: 4,
  get(src) {
    if (!this.cache.has(src)) {
      const p = new Promise((res, rej) => { this.queue.push({src, res, rej}); this.pump(); });
      p.catch(() => {});
      this.cache.set(src, p);
    }
    return this.cache.get(src);
  },
  pump() {
    while (this.active < this.LIMIT && this.queue.length) {
      const j = this.queue.shift(); this.active++;
      loadImage(j.src).then(j.res, j.rej).finally(() => { this.active--; this.pump(); });
    }
  },
  reset() { this.cache.forEach(p => p.then(o => URL.revokeObjectURL(o.url), () => {})); this.cache.clear(); }
};
function isAdoUrl(u) { return u.protocol === "https:" && (u.hostname === "dev.azure.com" || /\.visualstudio\.com$/i.test(u.hostname)); }
async function loadImage(src) {
  if (Auth.mode === "demo" && src.startsWith("demo:")) return demoImage(src);
  const u = new URL(src, ADO + "/");
  // The token is only ever sent to Azure DevOps itself, never to other hosts.
  const headers = isAdoUrl(u) ? {Authorization: await Auth.header()} : {};
  const r = await fetch(u.href, {headers, credentials: "omit"});
  if (!r.ok || r.status === 203) throw new Error("HTTP " + r.status);
  const ct = r.headers.get("content-type") || "";
  if (/html|json/i.test(ct)) throw new Error("not an image");
  const blob = await r.blob();
  return {blob, url: URL.createObjectURL(blob)};
}

function openLightbox(url, caption) {
  $("lbImg").src = url; $("lbCap").textContent = caption || "";
  $("lightbox").classList.remove("hidden");
}
function closeLightbox() { $("lightbox").classList.add("hidden"); $("lbImg").removeAttribute("src"); }

function hydrateImages(container, t) {
  container.querySelectorAll(".imgref").forEach(el => {
    const r = t.rows[+el.dataset.r], im = r && r.images ? r.images[+el.dataset.i - 1] : null;
    if (!im) return;
    Img.get(im.src).then(o => {
      const img = document.createElement("img");
      img.className = "thumb"; img.src = o.url; img.alt = im.name || ("תמונה " + el.dataset.i); img.loading = "lazy";
      img.title = "לחצו להגדלה";
      img.onclick = () => openLightbox(o.url, (im.name ? im.name + " · " : "") + "פריט " + r.id);
      img.onerror = () => { el.classList.add("failed"); el.querySelector(".ph").textContent = "[תמונה " + el.dataset.i + " · לא ניתן להציג]"; img.remove(); };
      el.querySelector(".ph").classList.add("sr");
      el.appendChild(img);
    }, () => {
      el.classList.add("failed");
      el.querySelector(".ph").textContent = "[תמונה " + el.dataset.i + " · לא נטענה]";
      el.title = "לא ניתן לטעון את התמונה מ-Azure DevOps. פתחו את הפריט כדי לראות אותה.";
    });
  });
}

/* ============================ UI ============================ */
const $ = id => document.getElementById(id);
const msgs = $("msgs");

function toast(text) { const el = $("toast"); el.textContent = text; el.classList.add("show"); clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove("show"), 2600); }
function scrollDown() { const c = $("chat"); c.scrollTop = c.scrollHeight; }
function addMsg(cls, html) { const d = document.createElement("div"); d.className = "msg " + cls; d.innerHTML = html; msgs.appendChild(d); scrollDown(); return d; }

function helpHtml(first) {
  return '<div class="help">' + (first ? "<h3>שלום" + (Auth.userName ? " " + escHtml(Auth.userName) : "") + "!</h3>" : "<h3>איך משתמשים</h3>") +
    "כתבו מספרים של Work Items, וקבלו טבלה. כמה דוגמאות:<ul>" +
    "<li><code>110047, 112074</code> שדות ברירת המחדל</li>" +
    "<li><code>110047 112074 רק Title ו-State</code> רק השדות האלה</li>" +
    "<li><code>110047 תוסיף Tags ו-Story Points</code> ברירת מחדל ועוד שדות</li>" +
    "<li><code>110047 בלי Priority ו-WSJF Priority</code> להוריד שדות</li>" +
    "<li><code>עזרה</code> להציג את ההסבר הזה שוב · <code>נקה</code> לנקות את השיחה</li></ul>" +
    "<b>עדכון:</b> לחצו על תא בטבלה או על ✎, או כתבו פקודה. כל עדכון מוצג קודם לאישור.<ul>" +
    "<li><code>112074 State Resolved</code> · <code>110047 112074 Iteration 4.2</code></li>" +
    "<li><code>112074 שייך לאני</code> · <code>112074 Priority=2; Tags +SAP</code></li>" +
    "<li><code>112074 תגובה: נבדק בסביבת QA</code></li></ul>" +
    "<b>יצירה:</b> כפתור <b>+ פריט חדש</b> למעלה, <b>+ תת-פריט</b> בחלון העריכה, או פקודה. הטופס נפתח למילוי ולאישור.<ul>" +
    "<li><code>חדש Task תחת 110047: בדיקת ממשק</code> · <code>צור באג: שגיאה בשמירה</code></li>" +
    "<li><code>חדש Feature: דוח חודשי; Leading Squad Meteor</code></li></ul>" +
    '<div class="notes">העמודות שלך כרגע: ' + getDefaultFields().join(", ") + (hasPersonalFields() ? " (הגדרה אישית)" : "") +
    "<br>שדות נוספים שאפשר לבקש: " + FIELDS.filter(f => !getDefaultFields().some(d => sameField(d, f.name))).map(f => f.name).join(", ") +
    ", וגם כל שדה מותאם של הפרויקט לפי שמו. בבאג, עמודת Description מציגה את Repro Steps. תמונות מוצגות בתוך הטבלה, ולחיצה עליהן מגדילה. כפתור העתקת טבלה מעתיק גם את התמונות.</div></div>";
}

const NOT_EDITABLE_KINDS = new Set(["id", "attach", "none"]);
function renderResult(t, req, el, items) {
  const found = t.rows.length - t.missing.length;
  const fresh = !el;
  if (fresh) { el = addMsg("bot", ""); Results.add(el, t, req, items || []); }
  else el.innerHTML = "";
  const meta = document.createElement("div"); meta.className = "meta";
  meta.innerHTML = "<span>" + found + " מתוך " + t.rows.length + " פריטים" + (req.customized ? " · שדות מותאמים" : "") + '</span><span class="sp"></span>';
  const actions = document.createElement("div"); actions.className = "actions";
  const copyB = document.createElement("button"); copyB.className = "btn ghost"; copyB.textContent = "העתקת טבלה"; copyB.onclick = () => copyTable(t, copyB);
  const xlsB = document.createElement("button"); xlsB.className = "btn ghost"; xlsB.textContent = "הורדה ל-Excel"; xlsB.onclick = () => downloadXlsx(t, xlsB);
  actions.append(copyB, xlsB); meta.appendChild(actions); el.appendChild(meta);

  const wrap = document.createElement("div"); wrap.className = "tbl";
  let h = "<table><thead><tr>" + t.cols.map(c => "<th>" + escHtml(c.label) + "</th>").join("") + "</tr></thead><tbody>";
  t.rows.forEach((r, ri) => {
    h += "<tr>" + r.cells.map((v, i) => {
      const c = t.cols[i];
      const edBtn = '<button type="button" class="rowedit" data-r="' + ri + '" title="עריכה" aria-label="עריכת ' + r.id + '">✎</button>';
      if (c.ref === "id" && !r.missing && Auth.mode !== "demo") return '<td class="idc"><a target="_blank" rel="noopener" href="' + ADO + "/" + encodeURIComponent(r.project || "") + "/_workitems/edit/" + r.id + '">' + escHtml(v) + "</a>" + edBtn + "</td>";
      if (c.ref === "id" && !r.missing) return '<td class="idc">' + escHtml(v) + edBtn + "</td>";
      const long = v.length > 80 || v.includes("\n");
      const cls = r.missing && c.label === "Title" ? "missing" : v === "—" || v === "לא נמצא" ? "na" : c.kind === "attach" ? "att" : long ? "long" : "";
      const body = escHtml(v).replace(/\[תמונה (\d+)\]/g, (m, n) => '<span class="imgref" data-r="' + ri + '" data-i="' + n + '"><span class="ph">' + m + "</span></span>");
      const editable = !r.missing && c.ref && !NOT_EDITABLE_KINDS.has(c.kind) && c.ref !== "System.WorkItemType" && c.ref !== "System.TeamProject";
      return '<td class="' + cls + (editable ? " ed" : "") + '"' + (editable ? ' data-r="' + ri + '" data-c="' + i + '" title="לחצו לעריכה"' : "") + ">" + body + "</td>";
    }).join("") + "</tr>";
  });
  wrap.innerHTML = h + "</tbody></table>";
  el.appendChild(wrap);
  hydrateImages(wrap, t);
  wrap.addEventListener("click", e => {
    if (e.target.closest("a, img")) return;
    const b = e.target.closest(".rowedit");
    if (b) { EditPanel.open(el, +b.dataset.r, null); return; }
    const td = e.target.closest("td.ed");
    if (td && !getSelection().toString()) EditPanel.open(el, +td.dataset.r, +td.dataset.c);
  });

  const notes = [];
  if (t.missing.length) notes.push("לא נמצאו או שאין הרשאה: " + t.missing.join(", "));
  if (t.unknown.length) notes.push("שדות שלא נמצאו בפריטים: " + t.unknown.join(", "));
  if (t.projects.length > 1) notes.push("הפריטים שייכים לכמה פרויקטים: " + t.projects.join(", ") + ". אפשר להוסיף את העמודה Project.");
  if (notes.length) { const n = document.createElement("div"); n.className = "notes"; n.innerHTML = notes.map(escHtml).join("<br>"); el.appendChild(n); }
  if (fresh) scrollDown();
  return el;
}

let busy = false;
async function handleInput(text) {
  if (!text.trim() || busy) return;
  addMsg("user", escHtml(text));
  const req = parseRequest(text);
  if (req.cmd === "help") { addMsg("bot", helpHtml(false)); return; }
  if (req.cmd === "clear") { msgs.innerHTML = ""; addMsg("bot", helpHtml(true)); return; }
  const cr = ChatCreate.parse(text);
  if (cr) {
    busy = true; $("sendBtn").disabled = true;
    try { await ChatCreate.run(cr); }
    catch (e) { addMsg("bot error", escHtml(e.message || String(e))); }
    finally { busy = false; $("sendBtn").disabled = false; }
    return;
  }
  let upd = null;
  try { upd = await ChatEdit.parse(text); } catch (e) { upd = null; }
  if (upd) {
    busy = true; $("sendBtn").disabled = true;
    try { await ChatEdit.run(upd); }
    catch (e) {
      addMsg("bot error", escHtml(e.message || String(e)));
      if (e instanceof AuthError && Auth.mode === "pat") { await Auth.logout(); setTimeout(() => showLogin(e.message), 1500); }
    } finally { busy = false; $("sendBtn").disabled = false; $("input").focus(); }
    return;
  }
  if (!req.ids.length) { addMsg("bot", "לא מצאתי מספרים בהודעה. כתבו מספר אחד או יותר של Work Items, למשל <code>110047, 112074</code>, או <code>עזרה</code>."); return; }
  if (req.ids.length > CONFIG.MAX_IDS) { addMsg("bot error", "אפשר עד " + CONFIG.MAX_IDS + " מספרים בהודעה אחת."); return; }
  busy = true; $("sendBtn").disabled = true;
  const wait = addMsg("bot typing", "שולף " + req.ids.length + " פריטים...");
  try {
    const items = await fetchItems(req.ids);
    People.fromItems(items);
    wait.remove();
    renderResult(buildTable(req.fields, items, req.ids), req, null, items);
  } catch (e) {
    wait.remove();
    if (e instanceof AuthError) {
      addMsg("bot error", escHtml(e.message));
      if (Auth.mode === "pat") { await Auth.logout(); setTimeout(() => showLogin(e.message), 1500); }
    } else addMsg("bot error", escHtml(e.message || String(e)));
  } finally { busy = false; $("sendBtn").disabled = false; $("input").focus(); }
}

function showLogin(err) {
  $("app").classList.add("hidden"); $("login").classList.remove("hidden");
  $("msBlock").classList.toggle("hidden", !(CONFIG.CLIENT_ID && window.msal));
  const e = $("loginErr"); e.classList.toggle("hidden", !err); e.textContent = err || "";
}
function showApp() {
  $("login").classList.add("hidden"); $("app").classList.remove("hidden");
  $("orgName").textContent = CONFIG.ORG;
  $("who").textContent = Auth.userName || "";
  $("demoBanner").classList.toggle("hidden", Auth.mode !== "demo");
  msgs.innerHTML = ""; addMsg("bot", helpHtml(true));
  $("input").focus();
}

function initUi() {
  $("patHelp").href = ADO + "/_usersSettings/tokens";
  $("msLogin").onclick = async () => { try { await Auth.loginMicrosoft(); } catch (e) { showLogin("ההתחברות נכשלה: " + (e.message || e)); } };
  $("patForm").onsubmit = async ev => {
    ev.preventDefault();
    const v = $("pat").value.trim(); if (!v) return;
    $("patBtn").disabled = true; $("patBtn").textContent = "בודק...";
    try { await Auth.loginPat(v, $("remember").checked); $("pat").value = ""; showApp(); }
    catch (e) { Auth.mode = null; showLogin(e.message || String(e)); }
    finally { $("patBtn").disabled = false; $("patBtn").textContent = "כניסה עם טוקן"; }
  };
  $("demoBtn").onclick = () => { sessionStorage.setItem("ado_demo", "1"); Auth.mode = "demo"; Auth.userName = "משתמש הדגמה"; Auth.userEmail = "demo.user@example.com"; showApp(); };
  $("logoutBtn").onclick = async () => { await Auth.logout(); showLogin(); };
  $("clearBtn").onclick = () => { msgs.innerHTML = ""; addMsg("bot", helpHtml(true)); };
  initSettings();
  $("lightbox").onclick = closeLightbox;
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("lightbox").classList.contains("hidden")) closeLightbox(); });
  $("verLogin").textContent = "גרסה " + CONFIG.VERSION;
  $("orgName").title = "גרסה " + CONFIG.VERSION;
  const input = $("input");
  $("composer").onsubmit = ev => { ev.preventDefault(); const v = input.value; input.value = ""; autosize(); handleInput(v); };
  input.addEventListener("keydown", ev => { if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); $("composer").requestSubmit(); } });
  const autosize = () => { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; };
  input.addEventListener("input", autosize);
  const chips = ["רק Title ו-State", "תוסיף Tags", "בלי Description", "עזרה"];
  chips.forEach(c => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c;
    b.onclick = () => { if (c === "עזרה") { handleInput(c); return; } input.value = (input.value.trim() + " " + c).trim(); input.focus(); autosize(); };
    $("chips").appendChild(b); });
}

/* ============================ SETTINGS ============================ */
const FIELDS_KEY = "ado_default_fields";
function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function hasPersonalFields() { return !!safeGet(FIELDS_KEY); }
function getDefaultFields() {
  const raw = safeGet(FIELDS_KEY);
  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length && arr.every(x => typeof x === "string")) {
        const rest = arr.filter(f => !sameField(f, "ID"));
        return ["ID", ...rest];
      }
    } catch (e) {}
  }
  return [...CONFIG.DEFAULT_FIELDS];
}

let draft = [];
function openSettings() { draft = getDefaultFields(); renderSettings(); $("settings").classList.remove("hidden"); $("setSave").focus(); }
function closeSettings() { $("settings").classList.add("hidden"); $("input").focus(); }
function renderSettings() {
  const list = $("colList"); list.innerHTML = "";
  draft.forEach((name, i) => {
    const known = resolveKnown(name);
    const row = document.createElement("div"); row.className = "colrow";
    const locked = sameField(name, "ID");
    row.innerHTML = '<span class="nm">' + escHtml(known ? known.name : name) + (known ? "" : " <small>(שדה מותאם)</small>") + (locked ? " <small>(תמיד ראשון)</small>" : "") + "</span>";
    const mk = (txt, label, dis, fn, cls) => { const b = document.createElement("button"); b.type = "button"; b.className = "ib" + (cls ? " " + cls : ""); b.textContent = txt; b.title = label; b.setAttribute("aria-label", label + " " + name); b.disabled = dis; b.onclick = fn; return b; };
    row.append(
      mk("▲", "הזזה למעלה", locked || i <= 1, () => { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; renderSettings(); }),
      mk("▼", "הזזה למטה", locked || i === draft.length - 1, () => { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; renderSettings(); }),
      mk("✕", "הסרה", locked, () => { draft.splice(i, 1); renderSettings(); }, "del")
    );
    list.appendChild(row);
  });
  const sel = $("addSelect"); sel.innerHTML = "";
  const avail = FIELDS.filter(f => !draft.some(d => sameField(d, f.name)));
  if (!avail.length) sel.innerHTML = "<option value=''>כל השדות המוכרים כבר בטבלה</option>";
  avail.forEach(f => { const o = document.createElement("option"); o.value = f.name; o.textContent = f.name; sel.appendChild(o); });
  $("addKnown").disabled = !avail.length;
}
function addDraft(name) {
  name = (name || "").trim();
  if (!name) return;
  if (draft.some(d => sameField(d, name))) { toast("השדה כבר בטבלה"); return; }
  const known = resolveKnown(name);
  draft.push(known ? known.name : name); renderSettings();
}
function initSettings() {
  $("settingsBtn").onclick = openSettings;
  $("setCancel").onclick = closeSettings;
  $("settings").addEventListener("click", e => { if (e.target.id === "settings") closeSettings(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("settings").classList.contains("hidden")) closeSettings(); });
  $("addKnown").onclick = () => addDraft($("addSelect").value);
  $("addCustomBtn").onclick = () => { addDraft($("addCustom").value); $("addCustom").value = ""; };
  $("addCustom").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); $("addCustomBtn").click(); } });
  $("setReset").onclick = () => { draft = [...CONFIG.DEFAULT_FIELDS]; renderSettings(); toast("שוחזרה ברירת המחדל של הצוות. לחצו שמירה כדי להחיל"); };
  $("setSave").onclick = () => {
    const same = draft.length === CONFIG.DEFAULT_FIELDS.length && draft.every((d, i) => d === CONFIG.DEFAULT_FIELDS[i]);
    if (draft.length < 2) { toast("צריך לפחות עמודה אחת מלבד ID"); return; }
    const ok = safeSet(FIELDS_KEY, same ? null : JSON.stringify(draft));
    closeSettings();
    toast(ok ? "העמודות נשמרו" : "לא ניתן לשמור בדפדפן הזה. ההגדרה תחול עד סגירת הלשונית");
    if (!ok) CONFIG.DEFAULT_FIELDS = [...draft];
  };
}

/* ============================ DEMO DATA ============================ */
function demoItems(ids) {
  const people = [{displayName: "דנה כהן", uniqueName: "dana@example.com"}, {displayName: "יוסי לוי", uniqueName: "yossi@example.com"}, {displayName: "מאיה פרץ", uniqueName: "maya@example.com"}, {displayName: "אבי מזרחי", uniqueName: "avi@example.com"}];
  const stateFor = {"Bug": ["New", "Active", "Resolved", "Closed"], "User Story": ["New", "Active", "Testing", "Closed"], "Feature": ["New", "Solution", "Active", "Closed"], "Epic": ["New", "Ready", "Active", "Closed"]};
  return new Promise(res => setTimeout(() => res(ids.filter(id => id % 10 !== 9).map((id, i) => {
    const stored = DemoDB.get(id);
    if (stored) return stored;
    const type = id >= 900000 ? "Epic" : id % 5 === 0 ? "Feature" : id % 2 === 0 ? "Bug" : "User Story";
    const f = {
      "System.WorkItemType": type,
      "System.Title": type === "Epic" ? "תוכנית דיגיטציה רבעונית (הדגמה " + id + ")" : type === "Bug" ? "שגיאה בשמירת טופס בקשה (הדגמה " + id + ")" : type === "Feature" ? "ממשק דיווח חודשי ללקוח (הדגמה " + id + ")" : "הוספת סינון לפי תאריך במסך החיפוש (הדגמה " + id + ")",
      "System.State": stateFor[type][i % 4], "System.Reason": "Approved",
      "System.AssignedTo": people[i % 4], "System.CreatedBy": people[(i + 1) % 4],
      "System.CreatedDate": "2026-09-1" + (i % 9) + "T08:00:00Z", "System.ChangedDate": "2026-10-0" + ((i % 6) + 1) + "T10:00:00Z",
      "System.IterationPath": "Portfolio Merkava\\PI4_26\\4." + ((i % 3) + 1), "System.AreaPath": "Portfolio Merkava\\MK2\\Meteor\\Meteor Sigma",
      "System.TeamProject": "Portfolio Merkava", "System.Tags": type === "Bug" ? "Demo; UI" : "Demo",
      "Custom.WSJFPriority": i * 3, "Custom.Customer": "מימון ואשראי", "Custom.LeadingSquad": "Meteor",
      "Microsoft.VSTS.Common.ValueArea": "Business", "Custom.CR": false, "Custom.34c3825b-e2cf-4990-b473-d6a7e7d431e7": false, "Custom.Deliveryrisk": false,
      "Custom.d3d0252f-48df-4329-8b93-585a2c0f8dae": false, "Custom.Relevance": false, "Custom.Reviewed": false, "Custom.EscapingDefect": false, "Custom.Reopen": false, "Custom.OSS": false
    };
    if (type === "User Story") f["Microsoft.VSTS.Scheduling.StoryPoints"] = 3;
    if (type === "Bug") f["Microsoft.VSTS.TCM.ReproSteps"] = "<div>1. נכנסים למסך בקשה חדשה</div><div>2. ממלאים את כל השדות ולוחצים שמירה</div><div><br></div><div>התוצאה: מופיעה הודעת שגיאה כללית</div><div><img src='demo:inline-" + id + "' alt='צילום מסך'></div>";
    else if (type === "Feature") {
      const tpl = TeamConfig.template("Feature");
      f["System.Description"] = tpl ? templateHtml(tpl).replace(/(תאור הדרישה:<\/span><\/u><\/b><\/div>)<div[^>]*><br><\/div>/, '$1<div style="direction:rtl;">דוח חודשי מרוכז לכל לקוח, עם פילוח לפי מודול.</div>') : "<div>תיאור</div>";
    }
    else f["System.Description"] = "<p>כמשתמש, אני רוצה לסנן תוצאות לפי טווח תאריכים.</p><ul><li>שדה מתאריך</li><li>שדה עד תאריך</li></ul>";
    if (i % 3 === 0) f["Microsoft.VSTS.Common.Priority"] = 2;
    const relations = type === "Bug" ? [
      {rel: "AttachedFile", url: "demo:att-" + id, attributes: {name: "מסך-שגיאה.png"}},
      {rel: "AttachedFile", url: "demo:log-" + id, attributes: {name: "server-log.txt"}}
    ] : [];
    const it = {id, rev: 1, fields: f, relations};
    DemoDB.put(it);
    return DemoDB.get(id);
  })), 300));
}

function demoImage(src) {
  return new Promise((res, rej) => {
    const cv = document.createElement("canvas"); cv.width = 640; cv.height = 380;
    const ctx = cv.getContext("2d");
    const hue = [...src].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);
    ctx.fillStyle = "hsl(" + hue + ",45%,92%)"; ctx.fillRect(0, 0, 640, 380);
    ctx.fillStyle = "hsl(" + hue + ",50%,40%)"; ctx.fillRect(0, 0, 640, 54);
    ctx.fillStyle = "#fff"; ctx.font = "bold 24px sans-serif"; ctx.fillText("Demo screenshot", 20, 36);
    ctx.fillStyle = "#333"; ctx.font = "20px sans-serif"; ctx.fillText(src.replace("demo:", ""), 20, 110);
    ctx.strokeStyle = "#c33"; ctx.lineWidth = 4; ctx.strokeRect(20, 150, 360, 70);
    cv.toBlob(b => b ? res({blob: b, url: URL.createObjectURL(b)}) : rej(new Error("demo")), "image/png");
  });
}

/* ============================ START ============================ */
(async function start() {
  initUi();
  await TeamConfig.load();
  TeamUI.init();
  EditPanel.init();
  Pickers.init();
  try {
    if (await Auth.init()) showApp(); else showLogin();
  } catch (e) { showLogin("שגיאה בהתחברות: " + (e.message || e)); }
})();
