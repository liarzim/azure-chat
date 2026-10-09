"use strict";
/* ============================================================
   Feature breakdown (פירוק פיצ'ר), based on the team's
   "Agile Feature Breakdown Agent" skill.

   - BreakdownEngine.rules(input): built-in rules, no third party.
   - BreakdownEngine.prompt(input, draft) / parse(text): "שיפור עם AI"
     through any approved AI chat (copy, paste back).
   - BreakdownEngine.agent(url, input, draft): an existing agent, when
     the team settings name one (team-config.json: breakdownAgent).
   All three return the same shape (see docs/breakdown-schema.md):
   {feature:{title, sp, value, ui}, role, stories:[{title, asA, iWant, soThat,
    pattern, sp, priority, acceptance[], positive[], negative[], tasks:[{title}]}],
    sprints:[[storyIndex…]], uiPrompt, engine}
   ============================================================ */

const BD_PATTERNS = {
  value: "סוגי ערך למשתמש",
  paths: "מסלולי שימוש",
  ops: "תפעול/פעולות",
  incremental: "פיתוח אינקרמנטלי (מפשוט למורכב)",
  nfr: "דחיית מימוש דרישות לא פונקציונליות",
  spike: "Spike Story",
  workflow: "Workflow"
};

const BreakdownEngine = {
  /* ---------- input helpers ---------- */
  clean(s) { return String(s || "").replace(/\s+/g, " ").trim(); },
  firstSentence(s, max) {
    s = this.clean(s); max = max || 70;
    const cut = s.split(/(?<=[.!?\n])\s|[;:]\s/)[0] || s;
    return cut.length > max ? cut.slice(0, max).replace(/\s+\S*$/, "") + "…" : cut.replace(/[.!?]$/, "");
  },
  /* Hebrew prefix letters: ב/ל/כ swallow the definite ה ("ב" + "המוסדות" = "במוסדות"). */
  attach(pre, o) { o = String(o || ""); return /^[בלכ]$/.test(pre) && /^ה\S/.test(o) ? pre + o.slice(1) : pre + o; },
  et(o) { return /^ה\S/.test(o) ? "את " + o : o; },
  ACTION_NOUN: /^(מסך|ניהול|קליטת|שיפור|הוספת|הצגת|יצירת|פיתוח|הקמת|עדכון|מימוש|בניית|תצוגת|דוח|דו"ח|אפשרות|יכולת|כלי)$/,
  /* The thing the feature is about: "…רואה את כל המוסדות שקיבלו תמיכה" → "המוסדות שקיבלו תמיכה". */
  subject(text, title) {
    const m = /(?:^|\s)את\s+(?:כל\s+)?(ה[^\s,.;:]{2,}(?:\s+ש[^\s,.;:]+(?:\s+[^\s,.;:]+)?)?)/.exec(text);
    if (m) return m[1];
    let words = this.clean(String(title || text).split(/[:,]/)[0]).split(" ");
    while (words.length > 1 && this.ACTION_NOUN.test(words[0])) words.shift();
    const stop = words.findIndex((w, i) => i > 0 && (/^ו\S/.test(w) || /^(עם|לפי|מול|כולל|כדי|ממערכת|במערכת)$/.test(w)));
    if (stop > 0) words = words.slice(0, stop);
    return words.slice(0, 4).join(" ") || "הפיצ'ר";
  },
  criteria(text) {
    const m = /לפי\s+([^.;:\n]{2,80})/.exec(text);
    if (!m) return [];
    const phrase = m[1].split(/,\s*(?=ו|עם|כולל|וגם)/)[0];
    return phrase.split(/\s*,\s*|\s+ו(?=\S)|\s+או\s+/).map(x => x.trim())
      .filter(x => x && x.length < 30 && !this.RX.export.test(x) && !this.RX.notify.test(x)).slice(0, 3);
  },
  benefit(value) {
    let v = this.clean(value).replace(/[.!]+$/, "");
    if (!v) return "אוכל לבצע את העבודה מהר ובלי טעויות";
    v = v.replace(/^(כדי ש|כך ש|ש)/, "");
    return v.length > 110 ? v.slice(0, 110).replace(/\s+\S*$/, "") + "…" : v;
  },

  /* ---------- detection ---------- */
  RX: {
    add: /(הוספ|להוסיף|ליצור|יצירת|הקמת|להקים|רישום|לרשום|הזנת|להזין)/,
    view: /(הצג|להציג|לראות|צפיי|רשימ|תצוג|דשבורד|לוח מחוונים)/,
    edit: /(עריכ|לערוך|עדכון|לעדכן|לשנות|שינוי)/,
    del: /(מחיק|למחוק|הסרת|להסיר|ביטול|לבטל)/,
    search: /(חיפוש|לחפש)/,
    filter: /(סינון|לסנן|פילטר|מיון|למיין)/,
    adv: /(מתקדם|מורכב)/,
    export: /(ייצוא|לייצא|אקסל|excel|pdf|הדפס|להדפיס|דו"ח|דו״ח|דוח)/i,
    integ: /(ממשק|\bapi\b|מערכת אחרת|מערכת חיצונית|ממערכת|מול מערכת|סנכרו|אינטגרצ|שירות חיצוני)/i,
    notify: /(התרא|מייל|דוא"ל|דוא״ל|תזכורת|\bsms\b|הודעה ל)/i,
    perm: /(הרשא|לפי תפקיד|מורשה)/,
    nfr: /(ביצועים|מהירות|זמן תגובה|אבטח|נגישות|עומס|סקייל|scale)/i
  },
  ROLES: ["מנהל מערכת", "חשבת", "חשב", "מנהלת", "מנהל", "רכזת", "רכז", "נציג", "ספק", "מבקר", "אזרח", "לקוח", "עובד", "אדמין", "משתמש"],
  roles(text, main) {
    const found = [];
    const add = r => { r = this.clean(r).replace(/^כ-?/, ""); if (r && !found.some(x => x === r)) found.push(r); };
    if (main) add(main);
    this.ROLES.forEach(r => { if (new RegExp("(^|[\\s,(])[הלכוש]{0,2}" + r + "([\\s,.)]|$)").test(text) && !found.some(f => f.includes(r) || r.includes(f))) add(r); });
    if (!found.length) found.push("משתמש");
    return found.slice(0, 3);
  },

  /* ---------- texts per kind of story (acceptance criteria and 3+3 tests) ---------- */
  KINDS: {
    spike: {title: o => "Spike: בדיקת ממשק מול " + o, want: o => "לבדוק את הממשק מול " + o + " לפני הפיתוח", pattern: "spike", sp: 2, pr: 1,
      ac: o => ["נבדקה זמינות הממשק מול " + o + " בסביבת בדיקות", "תועדו מבנה הנתונים, ההרשאות והמגבלות", "התקבלה החלטה: אפשרי / לא אפשרי, עם הערכת מאמץ למימוש", "סיכונים ותלויות בצוותים אחרים נרשמו"],
      pos: o => ["קריאה לממשק מחזירה נתונים תקינים בסביבת בדיקות", "ניתן להתחבר עם ההרשאות שהוגדרו", "מבנה התשובה תואם לתיעוד"],
      neg: o => ["ממשק לא זמין: מתועדת התנהגות וזמן תגובה", "הרשאות חסרות: מתקבלת שגיאה מוגדרת", "נתונים חסרים או שגויים בתשובה מזוהים ומתועדים"]},
    view: {title: o => "צפייה " + BreakdownEngine.attach("ב", o), want: o => "לצפות " + BreakdownEngine.attach("ב", o), pattern: "ops", sp: 2, pr: 1,
      ac: o => ["מוצגת רשימה של " + o + " עם העמודות שהוגדרו", "כשאין נתונים מוצגת הודעה מתאימה", "הנתונים תואמים למקור", "הרשימה נטענת בזמן סביר"],
      pos: o => ["כניסה למסך מציגה את " + o + " הקיימים", "הערכים בכל עמודה תואמים לנתוני המקור", "רשימה ארוכה מוצגת עם גלילה או דפדוף"],
      neg: o => ["אין נתונים: מוצגת הודעה ולא מסך ריק", "משתמש ללא הרשאה לא רואה את המסך", "שגיאת שרת: מוצגת הודעה ברורה"]},
    add: {title: o => "הוספת " + o.replace(/^ה(?=\S)/, ""), want: o => "להוסיף " + o.replace(/^ה(?=\S)/, ""), pattern: "ops", sp: 2, pr: 1,
      ac: o => ["ניתן להוסיף " + o + " עם כל שדות החובה", "שדות חובה חסרים מסומנים ולא ניתן לשמור", "לאחר השמירה מוצגת הודעת הצלחה והפריט מופיע ברשימה", "ערכים לא תקינים נחסמים עם הסבר"],
      pos: o => ["הוספה עם כל השדות התקינים נשמרת", "הפריט החדש מופיע מיד ברשימה", "הוספה עם שדות רשות ריקים נשמרת"],
      neg: o => ["שדה חובה ריק: השמירה נחסמת", "ערך בפורמט שגוי: מוצגת הודעת שגיאה", "פריט כפול: מוצגת אזהרה"]},
    edit: {title: o => "עדכון " + o, want: o => "לעדכן " + BreakdownEngine.et(o), pattern: "ops", sp: 2, pr: 2,
      ac: o => ["ניתן לפתוח פריט קיים ולשנות את שדותיו", "השינויים נשמרים ומוצגים מיד", "אותם כללי תקינות של הוספה חלים גם בעדכון", "ביטול לא שומר שינויים"],
      pos: o => ["שינוי שדה ושמירה מעדכנים את הפריט", "ביטול משאיר את הערכים הקודמים", "עדכון מספר שדות יחד נשמר"],
      neg: o => ["מחיקת ערך משדה חובה: השמירה נחסמת", "ערך לא תקין: מוצגת הודעת שגיאה", "פריט שנמחק בינתיים: מוצגת הודעה מתאימה"]},
    del: {title: o => "מחיקת " + o, want: o => "למחוק " + BreakdownEngine.et(o) + " כשאינם נדרשים", pattern: "ops", sp: 2, pr: 3,
      ac: o => ["ניתן למחוק פריט אחרי אישור", "פריט שנמחק לא מופיע ברשימה", "פריט שיש לו תלויות לא נמחק בלי אזהרה"],
      pos: o => ["מחיקה עם אישור מסירה את הפריט", "ביטול באישור משאיר את הפריט", "מחיקה מעודכנת גם אצל משתמשים אחרים"],
      neg: o => ["משתמש ללא הרשאה לא רואה כפתור מחיקה", "פריט עם תלויות: מוצגת אזהרה", "שגיאת שרת במחיקה: הפריט לא נעלם מהרשימה"]},
    filter: {title: (o, c) => "סינון לפי " + c, want: (o, c) => "לסנן " + BreakdownEngine.et(o) + " לפי " + c, pattern: "incremental", sp: 2, pr: 2,
      ac: (o, c) => ["ניתן לסנן לפי " + c, "התוצאות מתעדכנות לפי הסינון", "ניתן לנקות את הסינון ולחזור לכל הרשימה", "כשאין תוצאות מוצגת הודעה"],
      pos: (o, c) => ["סינון לפי " + c + " מציג רק תוצאות מתאימות", "שילוב עם סינון אחר מצמצם את התוצאות", "ניקוי הסינון מחזיר את כל הרשימה"],
      neg: (o, c) => ["ערך " + c + " שאין לו תוצאות: מוצגת הודעה", "ערך לא תקין בשדה הסינון נחסם", "סינון לא משנה את הנתונים עצמם"]},
    search: {title: o => "חיפוש פשוט " + BreakdownEngine.attach("ב", o), want: o => "לחפש " + BreakdownEngine.attach("ב", o) + " לפי מילים", pattern: "paths", sp: 2, pr: 2,
      ac: o => ["חיפוש מילה מחזיר פריטים מתאימים", "ניתן לחפש גם חלק ממילה", "כשאין תוצאות מוצגת הודעה"],
      pos: o => ["חיפוש מילה קיימת מחזיר את הפריט", "חיפוש חלק ממילה מחזיר תוצאות", "חיפוש עם רווחים מיותרים עובד"],
      neg: o => ["מילה שלא קיימת: מוצגת הודעה", "חיפוש ריק לא מבוצע", "תווים מיוחדים לא שוברים את החיפוש"]},
    advsearch: {title: o => "חיפוש מתקדם " + BreakdownEngine.attach("ב", o), want: o => "לחפש " + BreakdownEngine.attach("ב", o) + " עם כמה תנאים יחד", pattern: "paths", sp: 3, pr: 3,
      ac: o => ["ניתן לשלב כמה תנאים בחיפוש", "ניתן לשמור את תנאי החיפוש לשימוש חוזר", "התוצאות תואמות לכל התנאים"],
      pos: o => ["שילוב שני תנאים מחזיר רק תוצאות שעומדות בשניהם", "חיפוש שמור נטען נכון", "שינוי תנאי מעדכן את התוצאות"],
      neg: o => ["תנאים סותרים: מוצגת הודעה שאין תוצאות", "שדה תנאי חובה ריק: החיפוש נחסם", "יותר מדי תוצאות: מוצגת הגבלה"]},
    export: {title: o => "ייצוא לאקסל", want: o => "לייצא " + BreakdownEngine.et(o) + " לאקסל", pattern: "paths", sp: 2, pr: 3,
      ac: o => ["ייצוא יוצר קובץ אקסל עם העמודות המוצגות", "הייצוא מכבד את הסינון הנוכחי", "קובץ נפתח בעברית ומימין לשמאל"],
      pos: o => ["ייצוא רשימה מלאה יוצר קובץ תקין", "ייצוא אחרי סינון כולל רק את המסוננים", "פתיחת הקובץ מציגה עברית תקינה"],
      neg: o => ["ייצוא רשימה ריקה: מוצגת הודעה", "רשימה גדולה מאוד: מוצגת הודעת המתנה ולא קריסה", "משתמש ללא הרשאה לא רואה כפתור ייצוא"]},
    integ: {title: o => "קליטת נתונים " + BreakdownEngine.attach("מ", o), want: o => "לקבל נתונים " + BreakdownEngine.attach("מ", o) + " אוטומטית", pattern: "workflow", sp: 3, pr: 2,
      ac: o => ["הנתונים נקלטים מהממשק לפי ההגדרה שנקבעה בבדיקת הממשק", "קליטה כפולה לא יוצרת כפילויות", "כשל בקליטה נרשם ומדווח"],
      pos: o => ["קליטה תקינה מעדכנת את הנתונים", "קליטה חוזרת לא יוצרת כפילויות", "שדות ממופים נכון"],
      neg: o => ["ממשק לא זמין: הקליטה נכשלת ומדווחת", "נתון חסר בשדה חובה: הרשומה נדחית עם סיבה", "פורמט שגוי: הרשומה נדחית"]},
    notify: {title: o => "התראות על שינויים", want: o => "לקבל התראה על שינויים " + BreakdownEngine.attach("ב", o), pattern: "workflow", sp: 2, pr: 3,
      ac: o => ["נשלחת התראה כשמתרחש האירוע שהוגדר", "ההתראה כוללת קישור לפריט", "ניתן לבטל קבלת התראות"],
      pos: o => ["אירוע מוגדר שולח התראה לנמען הנכון", "הקישור בהתראה פותח את הפריט", "ביטול התראות עוצר את המשלוח"],
      neg: o => ["נמען בלי כתובת: ההתראה לא נשלחת ונרשמת שגיאה", "אירוע לא מוגדר לא שולח התראה", "כשל במשלוח לא חוסם את הפעולה עצמה"]},
    perm: {title: o => "הרשאות לפי תפקיד", want: o => "לקבוע מי רשאי לצפות ולעדכן " + BreakdownEngine.et(o), pattern: "value", sp: 3, pr: 2,
      ac: o => ["ניתן להגדיר הרשאות לפי תפקיד", "משתמש רואה רק את מה שמותר לו", "שינוי הרשאה חל מהכניסה הבאה"],
      pos: o => ["משתמש מורשה רואה ומעדכן", "משתמש צפייה רואה בלבד", "מנהל משנה הרשאה בהצלחה"],
      neg: o => ["משתמש לא מורשה לא רואה את המסך", "ניסיון עדכון בלי הרשאה נחסם", "קישור ישיר בלי הרשאה נחסם"]},
    nfr: {title: o => "ביצועים ואבטחה", want: o => "שהמערכת תעבוד מהר ובצורה מאובטחת גם בעומס", pattern: "nfr", sp: 3, pr: 3,
      ac: o => ["זמן תגובה עומד ביעד שהוגדר", "המערכת עומדת בעומס הצפוי", "דרישות אבטחת המידע מתקיימות"],
      pos: o => ["טעינה בעומס רגיל בתוך היעד", "עומס שיא נתמך בלי שגיאות", "בדיקת אבטחה עוברת"],
      neg: o => ["עומס חריג: המערכת מאטה ולא קורסת", "ניסיון גישה לא מורשה נחסם ונרשם", "קלט זדוני נחסם"]},
    role: {title: (o, c) => "תצוגה מותאמת " + BreakdownEngine.attach("ל", c), want: (o, c) => "לצפות " + BreakdownEngine.attach("ב", o) + " בתצוגה המותאמת לתפקיד שלי", pattern: "value", sp: 2, pr: 3,
      ac: (o, c) => ["למשתמש מסוג " + c + " מוצגת תצוגה מותאמת", "הפעולות הזמינות תואמות לתפקיד", "אין חשיפה למידע שאינו מותר לתפקיד"],
      pos: (o, c) => [c + " רואה את התצוגה שלו", "הפעולות המותרות זמינות", "מעבר בין תפקידים מציג תצוגה נכונה"],
      neg: (o, c) => ["תפקיד אחר לא רואה את התצוגה של " + c, "פעולה לא מותרת לא מוצגת", "קישור ישיר לתצוגה לא מורשית נחסם"]},
    mvp: {title: o => "גרסה בסיסית: " + o, want: o => "גרסה בסיסית שעובדת של " + o, pattern: "incremental", sp: 2, pr: 1,
      ac: o => ["הפעולה המרכזית עובדת מקצה לקצה", "שדות החובה נבדקים", "הודעת הצלחה או שגיאה ברורה"],
      pos: o => ["תרחיש מרכזי עובד", "הנתונים נשמרים נכון", "התוצאה מוצגת למשתמש"],
      neg: o => ["שדה חובה חסר: הפעולה נחסמת", "שגיאת שרת: הודעה ברורה", "משתמש ללא הרשאה נחסם"]},
    extend: {title: o => "הרחבה למקרים נוספים", want: o => "להרחיב " + BreakdownEngine.et(o) + " למקרים נוספים", pattern: "incremental", sp: 2, pr: 2,
      ac: o => ["המקרים הנוספים שהוגדרו נתמכים", "התרחיש הבסיסי ממשיך לעבוד", "ההתנהגות מתועדת"],
      pos: o => ["מקרה נוסף ראשון עובד", "מקרה נוסף שני עובד", "התרחיש הבסיסי לא נפגע"],
      neg: o => ["מקרה לא נתמך: הודעה ברורה", "שילוב לא חוקי נחסם", "נתון חריג לא שובר את התהליך"]},
    edge: {title: o => "טיפול בחריגים ושגיאות", want: o => "שחריגים ושגיאות יטופלו בצורה ברורה", pattern: "nfr", sp: 2, pr: 3,
      ac: o => ["כל שגיאה מציגה הודעה ברורה", "אין אובדן נתונים בכשל", "החריגים נרשמים לבדיקה"],
      pos: o => ["שגיאה מטופלת ומוצגת", "ניסיון חוזר מצליח", "הנתונים נשמרים אחרי שחזור"],
      neg: o => ["כשל רשת: אין אובדן נתונים", "קלט קיצוני נחסם", "פעולה כפולה לא יוצרת כפילות"]}
  },

  /* ---------- the built-in rules ---------- */
  rules(input) {
    const text = this.clean(input.text), title = this.firstSentence(input.title || text, 70);
    const R = this.RX, has = k => R[k].test(text);
    const subject = this.subject(text, input.title || text);
    const roles = this.roles(text, input.role).filter((r, i) => i === 0 || !subject.includes(r));   // "ספק" in "ניהול ספקים" is the subject, not a user
    const role = roles[0];
    const benefit = this.benefit(input.value);
    const out = [];
    const push = (kind, extra, overrides) => {
      const K = this.KINDS[kind], o = (overrides && overrides.object) || subject;
      out.push({kind, title: K.title(o, extra), asA: K === this.KINDS.role ? extra : role, iWant: K.want(o, extra), soThat: benefit, pattern: BD_PATTERNS[K.pattern], sp: K.sp, priority: K.pr,
        acceptance: K.ac(o, extra), positive: K.pos(o, extra), negative: K.neg(o, extra), extra: extra || ""});
    };
    if (has("integ")) {
      const sys = (/(?:ממערכת|מול מערכת|מערכת)\s+(?!ו)([^\s.,;:]+)/.exec(text) || [])[1] || "המערכת החיצונית";
      push("spike", "", {object: sys.replace(/^(אחרת|חיצונית)$/, "המערכת החיצונית")});
      push("integ", "", {object: sys.replace(/^(אחרת|חיצונית)$/, "המערכת החיצונית")});
    }
    const filters = (has("filter") || has("search")) ? this.criteria(text) : [];
    if (has("view") || has("filter") || has("search") || has("export")) push("view");
    if (has("add")) push("add");
    if (has("edit")) push("edit");
    if (filters.length) filters.forEach(c => push("filter", c)); else if (has("filter")) push("filter", "השדות המרכזיים");
    if (has("search")) push(has("adv") ? "advsearch" : "search");
    if (has("export")) push("export");
    if (has("del")) push("del");
    if (has("notify")) push("notify");
    if (has("perm")) push("perm");
    roles.slice(1).forEach(r => push("role", r));
    if (has("nfr")) push("nfr");
    if (!out.length) { push("mvp"); push("extend"); push("edge"); }
    else if (out.length === 1) push("edge");
    return this.finish({feature: {title, value: this.clean(input.value), ui: !!input.ui}, role, stories: out}, "rules");
  },

  /* Titles, task list, sprint plan, UI prompt and the feature's Story Points. */
  finish(b, engine) {
    const ui = b.feature.ui;
    b.stories.forEach((s, i) => {
      s.sp = Math.max(2, Math.round(Number(s.sp) || 2));
      s.priority = Math.min(4, Math.max(1, Math.round(Number(s.priority) || 2)));
      if (!s.title) s.title = this.storyTitle(s);
      ["acceptance", "positive", "negative"].forEach(k => { s[k] = (Array.isArray(s[k]) ? s[k] : String(s[k] || "").split(/\n|;\s*/)).map(x => this.clean(x)).filter(Boolean); });
      if (!Array.isArray(s.tasks) || !s.tasks.length) s.tasks = this.defaultTasks(s, ui);
      s.tasks = s.tasks.map(t => typeof t === "string" ? {title: t} : {title: this.clean(t.title), hours: t.hours});
    });
    b.stories.sort((a, c) => a.priority - c.priority);
    const bySp = {}; b.stories.forEach((s, i) => { (bySp[s.priority] = bySp[s.priority] || []).push(i); });
    b.sprints = Object.keys(bySp).sort().map(k => bySp[k]);
    b.totalSp = b.stories.reduce((n, s) => n + s.sp, 0);
    b.feature.sp = 3;                       // the skill: feature-level estimate always starts at 3
    b.uiPrompt = ui ? (b.uiPrompt || this.uiPrompt(b)) : "";
    b.engine = engine;
    return b;
  },
  storyTitle(s) {
    const w = String(s.iWant || "").replace(/^ל/, "");
    return (w.charAt(0) === "ש" ? "דרישות ביצועים ואבטחה" : w).replace(/^(\S+)/, v => ({"צפות": "צפייה", "הוסיף": "הוספת", "עדכן": "עדכון", "מחוק": "מחיקת", "סנן": "סינון", "חפש": "חיפוש", "ייצא": "ייצוא", "קבל": "קבלת", "בדוק": "בדיקת", "קבוע": "קביעת"})[v] || v).slice(0, 80);
  },
  defaultTasks(s, ui) {
    if (s.pattern === BD_PATTERNS.spike) return [{title: "בדיקת היתכנות: " + s.title}];
    const t = [{title: "פיתוח: " + s.title}, {title: "בדיקות QA: " + s.title}];
    if (ui && !/ביצועים|ממשק|קבלת נתונים/.test(s.title)) t.splice(0, 0, {title: "עיצוב UI/UX: " + s.title});
    return t;
  },
  uiPrompt(b) {
    const lines = ["עצב/י מסכים לפיצ'ר: " + b.feature.title, "משתמש עיקרי: " + b.role, b.feature.value ? "ערך ללקוח: " + b.feature.value : "", "", "מסכים ושדות:"];
    b.stories.forEach((s, i) => {
      const k = s.kind || "";
      const parts = {view: "טבלה עם עמודות [השלימו], הודעה כשאין נתונים", add: "טופס הוספה: שדות [השלימו], כפתורים: שמירה, ביטול", edit: "טופס עריכה: אותם שדות, כפתורים: שמירה, ביטול",
        del: "כפתור מחיקה בכל שורה, עם חלון אישור", filter: "שדה סינון: " + (s.extra || "[השלימו]") + ", כפתור ניקוי סינון", search: "תיבת חיפוש מעל הטבלה",
        advsearch: "חלון חיפוש מתקדם עם כמה תנאים, כפתור שמירת חיפוש", export: "כפתור ייצוא לאקסל מעל הטבלה", notify: "הגדרות התראות: אירוע, נמענים, הפעלה/כיבוי",
        perm: "מסך הרשאות: תפקיד, צפייה, עדכון", role: "תצוגה מותאמת ל" + (s.extra || "תפקיד")}[k];
      if (parts) lines.push("- " + s.title + ": " + parts);
    });
    lines.push("", "סדר השדות מימין לשמאל, כפתור הפעולה הראשי משמאל למטה, תמיכה בעברית מלאה.");
    return lines.filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
  },

  /* ---------- "שיפור עם AI": a prompt for any approved AI chat, and its answer ---------- */
  /* The answer has two parts: a readable breakdown for the person, then the same content as JSON
     in one code block, which the person copies back into Azuri. */
  prompt(input, draft) {
    const skeleton = {feature: {title: "", value: "", ui: true}, role: "", stories: [{title: "", asA: "", iWant: "", soThat: "", pattern: "", sp: 2, priority: 1, acceptance: [""], positive: ["", "", ""], negative: ["", "", ""], tasks: [{title: ""}]}], uiPrompt: ""};
    return [
      "את/ה סוכן פירוק פיצ'רים לפי עקרונות אג'יל ושיטת העבודה באז'ור של סיגמה.",
      "פרק/י את הפיצ'ר שלמטה ליחידות עבודה קטנות (User Stories), לפי הכללים:",
      "1. כל US בפורמט: \"כ-[סוג משתמש], אני רוצה [פעולה] כך ש-[ערך]\".",
      "2. לכל US: תבנית פירוק אחת מתוך: " + Object.values(BD_PATTERNS).join(", ") + ". אם נדרש ממשק למערכת אחרת, השתמש/י ב-Spike Story.",
      "3. Story Points מחמיר לכל US, מינימום 2. עדיף US קטנים ושווים (4 של 2 SP עדיפים על 2 של 4 SP).",
      "4. Acceptance Criteria מפורטים, 3 תסריטי בדיקה חיוביים ו-3 שליליים לכל US.",
      "5. עדיפות 1 (גבוהה) עד 4 לפי ערך ומאמץ. עדיף שיהיו גם US בעלי ערך נמוך, כדי שאפשר יהיה לתעדף אותם למטה.",
      "6. Tasks נפתחים תחת US (פיתוח, בדיקות QA, ועיצוב UI/UX כשנדרש), לא כ-US נפרד.",
      "7. כל US עומד בכללי INVEST.",
      input.ui ? "8. נדרש UI/UX: הוסף/י פירוט מסכים, סדר שדות וכפתורי הפעלה." : "8. לא נדרש UI/UX.",
      "",
      "הפיצ'ר: " + this.clean(input.text),
      "משתמש עיקרי: " + (this.clean(input.role) || "משתמש"),
      "הערך העסקי ללקוח: " + (this.clean(input.value) || "[לא צוין]"),
      "האם נדרש UI/UX: " + (input.ui ? "כן" : "לא"),
      "",
      draft ? "טיוטה ראשונה (שפר/י אותה, אפשר להוסיף, לאחד ולפצל):\n" + JSON.stringify(this.strip(draft)) : "",
      "",
      "צורת התשובה (חשוב מאוד). כתוב/כתבי בעברית, בשני חלקים, בסדר הזה:",
      "",
      "חלק א: פירוק קריא לאדם. בלי JSON ובלי סוגריים מסולסלים. בדיוק במבנה הזה:",
      "## פירוק הפיצ'ר: [שם הפיצ'ר]",
      "**ערך ללקוח:** [הערך]",
      "**סיכום:** [מספר] User Stories · סך הכל [מספר] SP",
      "**תכנון ספרינטים:** ספרינט 1: US 1, US 2 · ספרינט 2: US 3 ...",
      "",
      "### US 1: [כותרת]",
      "[מספר] SP · עדיפות [1-4] · תבנית: [תבנית הפירוק]",
      "> כ[משתמש], אני רוצה [פעולה] כך ש[ערך]",
      "**תנאי קבלה:**",
      "- [תנאי]",
      "**בדיקות חיוביות:**",
      "1. [בדיקה]",
      "**בדיקות שליליות:**",
      "1. [בדיקה]",
      "**Tasks:** [Task] · [Task] · [Task]",
      "",
      "(וכך לכל US, עם קו מפריד --- בין US ל-US)",
      input.ui ? "\n### מסכים ושדות (UI/UX)\n[פירוט המסכים, סדר השדות והכפתורים, כרשימה]" : "",
      "",
      "חלק ב: אותו פירוק בדיוק, לחזרה לאז'ורי. כותרת: \"### להעתקה חזרה לאז'ורי\", ומתחתיה בלוק קוד אחד בלבד שמתחיל ב-```json ונגמר ב-```, ובו JSON תקין במבנה הזה (uiPrompt ריק אם לא נדרש UI/UX):",
      JSON.stringify(skeleton),
      "אל תוסיף/י שום טקסט אחרי בלוק הקוד."
    ].join("\n");
  },
  strip(b) { return {feature: {title: b.feature.title, value: b.feature.value, ui: b.feature.ui}, role: b.role, stories: b.stories.map(s => ({title: s.title, asA: s.asA, iWant: s.iWant, soThat: s.soThat, pattern: s.pattern, sp: s.sp, priority: s.priority, acceptance: s.acceptance, positive: s.positive, negative: s.negative, tasks: s.tasks})), uiPrompt: b.uiPrompt}; },
  /* Accepts the AI's answer (JSON, possibly wrapped in text or a code block) and normalises it. */
  parse(text, input) {
    const s = String(text || "");
    const tries = [];
    // 1. a ```json code block (the last one that holds the breakdown)
    const blocks = [...s.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(m => m[1]).reverse();
    blocks.forEach(b => tries.push(b));
    // 2. from the first "{" that opens the JSON to the last "}"
    const k = s.search(/\{\s*"(feature|role|stories|userStories)"/);
    if (k >= 0) tries.push(s.slice(k, s.lastIndexOf("}") + 1));
    const a = s.indexOf("{"), z = s.lastIndexOf("}");
    if (a >= 0 && z > a) tries.push(s.slice(a, z + 1));
    if (!tries.length) throw new Error("לא מצאתי בתשובה את החלק \"להעתקה חזרה לאז'ורי\". העתיקו את כל התשובה, או רק את בלוק הקוד שבסופה.");
    let lastErr = null;
    for (const t of tries) {
      const body = t.trim(), a2 = body.indexOf("{"), z2 = body.lastIndexOf("}");
      if (a2 < 0 || z2 <= a2) continue;
      let o;
      try { o = JSON.parse(body.slice(a2, z2 + 1)); } catch (e) { lastErr = e; continue; }
      if (o && (o.stories || o.userStories || o.us)) return this.normalize(o, input, "ai");
    }
    throw new Error(lastErr ? "החלק להעתקה לא בפורמט תקין (" + lastErr.message + "). העתיקו שוב את בלוק הקוד שבסוף התשובה, מההתחלה עד הסוף." : "בתשובה אין User Stories. העתיקו את בלוק הקוד שבסוף התשובה.");
  },
  normalize(o, input, engine) {
    const arr = o.stories || o.userStories || o.us || [];
    if (!Array.isArray(arr) || !arr.length) throw new Error("בתשובה אין User Stories.");
    const f = o.feature || {};
    const b = {feature: {title: this.clean(f.title) || this.firstSentence(input.text, 70), value: this.clean(f.value || input.value), ui: f.ui !== undefined ? !!f.ui : !!input.ui},
      role: this.clean(o.role || input.role) || "משתמש", uiPrompt: String(o.uiPrompt || "").trim(),
      stories: arr.slice(0, 40).map(x => ({title: this.clean(x.title || x.name || x["US Name"]), asA: this.clean(x.asA || x.role || o.role || input.role) || "משתמש", iWant: this.clean(x.iWant || x.want || x.description || x.Description), soThat: this.clean(x.soThat || x.goal || ""),
        pattern: this.clean(x.pattern || x.splittingPattern || x["Splitting Pattern"]), sp: x.sp || x.storyPoints || x["Story Points"], priority: x.priority || x.Priority,
        acceptance: x.acceptance || x.acceptanceCriteria || x["Acceptance Criteria"], positive: x.positive || x.positiveTests || x["Positive Tests"], negative: x.negative || x.negativeTests || x["Negative Tests"], tasks: x.tasks}))};
    return this.finish(b, engine);
  },

  /* ---------- an existing agent (team settings: breakdownAgent {url, label}) ---------- */
  async agent(cfg, input, draft) {
    const r = await fetch(cfg.url, {method: "POST", credentials: "omit", headers: {"Content-Type": "application/json", Accept: "application/json"},
      body: JSON.stringify({text: input.text, role: input.role, value: input.value, ui: !!input.ui, draft: draft ? this.strip(draft) : null})});
    if (!r.ok) throw new Error("הסוכן החזיר שגיאה " + r.status);
    return this.normalize(await r.json(), input, "agent");
  },

  /* ---------- exports ---------- */
  sentence(s) { return "כ" + s.asA.replace(/^כ-?/, "") + ", אני רוצה " + s.iWant + (s.soThat ? " כך ש" + s.soThat.replace(/^ש/, "") : ""); },
  csv(b) {
    const q = v => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
    const head = ["US Name", "Description", "Acceptance Criteria", "Story Points", "Priority", "Splitting Pattern", "Positive Tests", "Negative Tests", "Tasks"];
    const rows = b.stories.map(s => [s.title, this.sentence(s), s.acceptance.join("\n"), s.sp, s.priority, s.pattern, s.positive.join("\n"), s.negative.join("\n"), s.tasks.map(t => t.title).join("\n")]);
    return "﻿" + [head].concat(rows).map(r => r.map(q).join(",")).join("\r\n");
  },
  text(b) {
    const L = ["פירוק פיצ'ר: " + b.feature.title, "Story Points לפיצ'ר: " + b.feature.sp + " · סך הכל ב-User Stories: " + b.totalSp, ""];
    b.stories.forEach((s, i) => {
      L.push("US " + (i + 1) + ": " + s.title + " (" + s.sp + " SP, עדיפות " + s.priority + ", " + s.pattern + ")", this.sentence(s), "תנאי קבלה:");
      s.acceptance.forEach(a => L.push("- " + a)); L.push("בדיקות חיוביות:"); s.positive.forEach(a => L.push("+ " + a)); L.push("בדיקות שליליות:"); s.negative.forEach(a => L.push("- " + a));
      L.push("Tasks: " + s.tasks.map(t => t.title).join(" | "), "");
    });
    if (b.uiPrompt) L.push("UI/UX:", b.uiPrompt);
    return L.join("\n");
  }
};
if (typeof module !== "undefined") module.exports = {BreakdownEngine, BD_PATTERNS};
