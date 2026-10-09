"use strict";
/* ============================================================
   Team settings (team-config.json): required fields per type and
   Description templates. Loaded from the site; saved to GitHub.
   ============================================================ */

const GITHUB = {owner: "liarzim", repo: "azure-chat", path: "team-config.json", branch: "main"};

const TEAM_DEFAULT = {
  schema: 1,
  org: "GOI-Finance",
  project: "Portfolio Merkava",
  processId: "95ef57a0-7866-4020-8bcb-d9991ceaed89",
  types: ["Epic", "Feature", "User Story", "Task", "Bug"],
  /* Baseline set by the team (October 2026). Editable in "הגדרות צוות". */
  requiredFields: {
    "Epic": [],
    "Feature": [
      "System.AreaPath",
      "System.IterationPath",
      "Custom.StoryPointsValues",
      "Custom.LeadingSquad",
      "Custom.Customer",
      "Custom.Businesspriority"
    ],
    "User Story": [
      "Custom.Customer",
      "Custom.StoryPointsValues",
      "Custom.LeadingSquad"
    ],
    "Task": [
      "Microsoft.VSTS.Scheduling.OriginalEstimate"
    ],
    "Bug": []
  },
  /* AI chats offered by "שיפור עם AI" (the prompt is copied, the chat opens in a new tab). */
  aiTools: [
    {id: "m365", label: "Copilot (ארגוני)", url: "https://m365.cloud.microsoft/chat"},
    {id: "chatgpt", label: "ChatGPT", url: "https://chatgpt.com/"},
    {id: "claude", label: "Claude", url: "https://claude.ai/new"},
    {id: "gemini", label: "Gemini", url: "https://gemini.google.com/app"}
  ],
  templates: {
    "Feature": {
      "field": "System.Description",
      "headingColor": "#0033CC",
      "headings": [
        {
          "text": "תאור הדרישה",
          "required": true,
          "content": "",
          "aliases": []
        },
        {
          "text": "ערך ללקוח",
          "required": true,
          "content": "",
          "aliases": []
        },
        {
          "text": "Feature Specific ACCEPTENCE CRATIRIA (What to Demo?)",
          "required": false,
          "content": "",
          "aliases": []
        },
        {
          "text": "פיתרון ארכיטקט (שהארכיטקט מכיר את הנושא)",
          "required": false,
          "content": "",
          "aliases": []
        },
        {
          "text": "UX/UI- תרשים זרימה/סכימה (במידה ונדרש)",
          "required": false,
          "content": "",
          "aliases": []
        },
        {
          "text": "תלויות בצוותים אחרים",
          "required": false,
          "content": "",
          "aliases": []
        },
        {
          "text": "QA- הגדרת בדיקות ברמה גבוהה",
          "required": false,
          "content": "<div>0 - <span style=\"color: rgb(224, 0, 0);\">קריטי</span></div><div>3 - <span style=\"color: rgb(237, 125, 49);\">High</span></div><div>15 - <span style=\"color: rgb(0, 112, 192);\">Medium</span></div>",
          "aliases": []
        }
      ]
    }
  },
  updatedAt: null,
  updatedBy: null
};

const TeamConfig = {
  data: JSON.parse(JSON.stringify(TEAM_DEFAULT)),
  source: "default",          // "site" | "default"

  async load() {
    try {
      const r = await fetch("team-config.json?t=" + Date.now(), {cache: "no-store"});
      if (!r.ok) throw new Error("HTTP " + r.status);
      this.data = this.normalize(await r.json());
      this.source = "site";
    } catch (e) {
      this.data = this.normalize(JSON.parse(JSON.stringify(TEAM_DEFAULT)));
      this.source = "default";
    }
    return this.data;
  },

  normalize(d) {
    const out = Object.assign(JSON.parse(JSON.stringify(TEAM_DEFAULT)), d || {});
    out.types = Array.isArray(out.types) && out.types.length ? out.types : TEAM_DEFAULT.types.slice();
    out.requiredFields = out.requiredFields || {};
    out.types.forEach(t => { if (!Array.isArray(out.requiredFields[t])) out.requiredFields[t] = []; });
    out.templates = out.templates || {};
    Object.values(out.templates).forEach(tp => {
      tp.field = tp.field || "System.Description";
      tp.headingColor = tp.headingColor || "#0033CC";
      tp.headings = (tp.headings || []).map(h => ({text: String(h.text || "").trim(), required: !!h.required, content: sanitizeTemplateHtml(h.content || ""), aliases: Array.isArray(h.aliases) ? h.aliases : []}));
    });
    return out;
  },

  requiredFor(type) { return (this.data.requiredFields[type] || []).slice(); },
  template(type) {
    const t = this.data.templates[type];
    return t && t.headings && t.headings.length ? t : null;
  },
  clone() { return JSON.parse(JSON.stringify(this.data)); }
};

/* ---------- Template HTML ---------- */
const TEMPLATE_ALLOWED_TAGS = new Set(["DIV", "P", "SPAN", "B", "STRONG", "U", "I", "EM", "BR", "UL", "OL", "LI", "FONT"]);
function sanitizeTemplateHtml(html) {
  if (!html) return "";
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.firstChild;
  const walk = el => {
    [...el.childNodes].forEach(n => {
      if (n.nodeType === 3) return;
      if (n.nodeType === 1 && /^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|TEMPLATE|SVG|MATH)$/i.test(n.tagName)) { n.remove(); return; }
      if (n.nodeType !== 1 || !TEMPLATE_ALLOWED_TAGS.has(n.tagName)) {
        if (n.nodeType === 1) { walk(n); n.replaceWith(...n.childNodes); } else n.remove();
        return;
      }
      const color = n.style && n.style.color;
      const fontColor = n.tagName === "FONT" ? n.getAttribute("color") : "";
      [...n.attributes].forEach(a => n.removeAttribute(a.name));
      if (color) n.style.color = color;
      if (fontColor) { n.setAttribute("color", fontColor); }
      walk(n);
    });
  };
  walk(root);
  return root.innerHTML.trim();
}

function templateHtml(tpl) {
  if (!tpl) return "";
  const color = tpl.headingColor || "#0033CC";
  const html = tpl.headings.map(h => {
    const title = '<div style="direction:rtl;"><b><u><span style="color:' + color + '">' + escHtml(h.text) + ":</span></u></b></div>";
    const body = h.content ? h.content : '<div style="direction:rtl;"><br></div>';
    return title + body + '<div style="direction:rtl;"><br></div>';
  }).join("");
  return rtlBlocks(html);
}

/* Hebrew text: every top-level line is written right-to-left, the way Azure DevOps stores it.
   Lines that already set a direction keep it. */
const RTL_BLOCK_TAGS = /^(DIV|P|UL|OL|LI|H[1-6]|BLOCKQUOTE|TABLE|PRE)$/;
function rtlBlocks(html) {
  if (!html) return html;
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.firstChild;
  [...root.childNodes].forEach(n => { if (n.nodeType === 3 && n.nodeValue.trim()) { const d = doc.createElement("div"); n.replaceWith(d); d.appendChild(n); } });
  [...root.children].forEach(b => { if (RTL_BLOCK_TAGS.test(b.tagName) && !b.style.direction && !b.getAttribute("dir")) b.style.direction = "rtl"; });
  return root.innerHTML;
}

/* ---------- Keeping user text plain inside a template ----------
   Headings are bold, underlined and coloured. Browsers carry that formatting
   to the next line when Enter is pressed at the end of a heading, so text
   typed under a heading would look like a heading. These helpers remove the
   heading look from content lines and keep a blank line before each heading. */
function cssColor(c) { const d = document.createElement("span"); d.style.color = c; return d.style.color; }
function isHeadingBlock(tpl, el) {
  if (!tpl || !el) return false;
  const k = headingKey(el.textContent || "");
  if (!k) return false;
  return tpl.headings.some(h => [h.text, ...(h.aliases || [])].some(t => headingKey(t) === k));
}
function hasHeadingLook(tpl, el) {
  const col = cssColor(tpl.headingColor || "#0033CC");
  return [...el.querySelectorAll("span, font")].some(x => (x.style && x.style.color === col) || (x.tagName === "FONT" && cssColor(x.getAttribute("color") || "") === col));
}
/* Removes the heading colour, and the bold/underline wrapped around it, from one content line. */
function stripHeadingLook(tpl, block) {
  const col = cssColor(tpl.headingColor || "#0033CC");
  const unwrap = n => { n.replaceWith(...n.childNodes); };
  [...block.querySelectorAll("span, font")].forEach(x => {
    const isHead = (x.style && x.style.color === col) || (x.tagName === "FONT" && cssColor(x.getAttribute("color") || "") === col);
    if (!isHead) return;
    let p = x.parentElement;
    while (p && p !== block && /^(B|STRONG|U)$/.test(p.tagName)) { const up = p.parentElement; unwrap(p); p = up; }
    unwrap(x);
  });
  [...block.querySelectorAll("b, strong, u")].forEach(x => { if (!x.textContent.trim() && !x.querySelector("img")) unwrap(x); });
}
function isBlankBlock(el) { return !el.textContent.replace(/[\s ​]/g, "") && !el.querySelector("img"); }
function normalizeTemplateHtml(tpl, html) {
  if (!tpl || !html) return html;
  const doc = new DOMParser().parseFromString("<div>" + html + "</div>", "text/html");
  const root = doc.body.firstChild;
  // Loose text at the top level becomes its own line so it can be checked like the rest.
  [...root.childNodes].forEach(n => { if (n.nodeType === 3 && n.nodeValue.trim()) { const d = doc.createElement("div"); n.replaceWith(d); d.appendChild(n); } });
  const blocks = [...root.children];
  blocks.forEach(b => { if (!isHeadingBlock(tpl, b) && hasHeadingLook(tpl, b)) stripHeadingLook(tpl, b); });
  [...root.children].forEach((b, i) => {
    if (i === 0 || !isHeadingBlock(tpl, b)) return;
    const prev = b.previousElementSibling;
    if (prev && !isBlankBlock(prev)) { const sp = doc.createElement("div"); sp.appendChild(doc.createElement("br")); b.before(sp); }
  });
  return rtlBlocks(root.innerHTML);
}

/* Compare heading lines loosely: ignore spaces, colons and dashes. */
function headingKey(s) { return String(s).toLowerCase().replace(/[\s:：\-–—_]/g, ""); }

/* Checks a Description (HTML) against a template.
   applies=false when the text contains none of the template's headings
   (older items written without the template are not checked). */
function checkTemplate(tpl, html) {
  const res = {applies: false, missing: [], empty: []};
  if (!tpl) return res;
  const lines = cleanHtml(html || "").split("\n").map(l => l.trim()).filter(Boolean);
  const keys = tpl.headings.map(h => [h.text, ...(h.aliases || [])].map(headingKey));
  const isHeadingLine = l => keys.findIndex(ks => ks.includes(headingKey(l)));
  const pos = new Map();
  lines.forEach((l, i) => { const k = isHeadingLine(l); if (k >= 0 && !pos.has(k)) pos.set(k, i); });
  if (!pos.size) return res;
  res.applies = true;
  tpl.headings.forEach((h, k) => {
    if (!h.required) return;
    if (!pos.has(k)) { res.missing.push(h.text); return; }
    const start = pos.get(k) + 1;
    let end = lines.length;
    for (let i = start; i < lines.length; i++) if (isHeadingLine(lines[i]) >= 0) { end = i; break; }
    const content = lines.slice(start, end).filter(l => l.replace(/[\s •.\-–—_]/g, "").length > 0);
    if (!content.length) res.empty.push(h.text);
  });
  return res;
}

/* ---------- Saving to GitHub ---------- */
const GitHubStore = {
  KEY: "gh_token",
  token() { try { return sessionStorage.getItem(this.KEY) || localStorage.getItem(this.KEY) || ""; } catch (e) { return ""; } },
  setToken(t, remember) {
    try {
      sessionStorage.removeItem(this.KEY); localStorage.removeItem(this.KEY);
      if (t) (remember ? localStorage : sessionStorage).setItem(this.KEY, t);
    } catch (e) {}
  },
  url() { return "https://api.github.com/repos/" + GITHUB.owner + "/" + GITHUB.repo + "/contents/" + GITHUB.path; },
  async call(method, url, body) {
    const t = this.token();
    if (!t) throw new Error("חסר GitHub token. הגדירו אותו בלשונית 'חיבור ל-GitHub'.");
    let r;
    try {
      r = await fetch(url, {method, headers: {Authorization: "Bearer " + t, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(body ? {"Content-Type": "application/json"} : {})}, body: body ? JSON.stringify(body) : undefined});
    } catch (e) { throw new Error("אין חיבור ל-GitHub."); }
    if (r.status === 401) throw new Error("ה-GitHub token לא תקין או שפג תוקפו.");
    if (r.status === 403 || r.status === 404) throw new Error("ל-GitHub token אין הרשאת כתיבה ל-" + GITHUB.owner + "/" + GITHUB.repo + ".");
    if (r.status === 409) throw new Error("הקובץ ב-GitHub השתנה בזמן השמירה. טענו מחדש ונסו שוב.");
    if (!r.ok) throw new Error("GitHub החזיר שגיאה " + r.status);
    return r.json();
  },
  async test() {
    const d = await this.call("GET", "https://api.github.com/repos/" + GITHUB.owner + "/" + GITHUB.repo);
    if (d.permissions && d.permissions.push === false) throw new Error("ל-token יש הרשאת קריאה בלבד.");
    return d.full_name;
  },
  async read() {
    const d = await this.call("GET", this.url() + "?ref=" + GITHUB.branch);
    const bytes = Uint8Array.from(atob(String(d.content).replace(/\n/g, "")), c => c.charCodeAt(0));
    return {sha: d.sha, json: JSON.parse(new TextDecoder().decode(bytes))};
  },
  async save(data, expectedUpdatedAt, force) {
    const remote = await this.read();
    if (!force && (remote.json.updatedAt || null) !== (expectedUpdatedAt || null)) {
      const e = new Error("מישהו אחר שמר הגדרות מאז שפתחת את המסך (" + (remote.json.updatedBy || "לא ידוע") + ").");
      e.conflict = true; e.remote = remote.json; throw e;
    }
    const text = JSON.stringify(data, null, 2) + "\n";
    const bytes = new TextEncoder().encode(text);
    let bin = ""; for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return this.call("PUT", this.url(), {message: "עדכון הגדרות צוות (אז'ורי)" + (data.updatedBy ? " · " + data.updatedBy : ""), content: btoa(bin), sha: remote.sha, branch: GITHUB.branch});
  }
};
