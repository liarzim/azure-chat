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
  /* The answer is one CSV file in a fixed format (the skill's columns), the same file Azuri exports.
     Any AI tool can write it; Azuri reads it back from an upload or a paste. */
  CSV_HEAD: ["US Name", "Description", "Acceptance Criteria", "Story Points", "Priority", "Splitting Pattern", "Positive Tests", "Negative Tests", "Tasks", "UI/UX"],
  prompt(input, draft) {
    return [
      "את/ה סוכן פירוק פיצ'רים לפי עקרונות אג'יל ושיטת העבודה באז'ור של סיגמה.",
      "פרק/י את הפיצ'ר שלמטה ליחידות עבודה קטנות (User Stories), לפי הכללים:",
      "1. כל US בפורמט: \"כ[סוג משתמש], אני רוצה [פעולה] כך ש[ערך]\".",
      "2. לכל US: תבנית פירוק אחת מתוך: " + Object.values(BD_PATTERNS).join(", ") + ". אם נדרש ממשק למערכת אחרת, השתמש/י ב-Spike Story.",
      "3. Story Points מחמיר לכל US, מינימום 2. עדיף US קטנים ושווים (4 של 2 SP עדיפים על 2 של 4 SP).",
      "4. Acceptance Criteria מפורטים, 3 תסריטי בדיקה חיוביים ו-3 שליליים לכל US.",
      "5. עדיפות 1 (גבוהה) עד 4 לפי ערך ומאמץ. עדיף שיהיו גם US בעלי ערך נמוך, כדי שאפשר יהיה לתעדף אותם למטה.",
      "6. Tasks נפתחים תחת US (פיתוח, בדיקות QA, ועיצוב UI/UX כשנדרש), לא כ-US נפרד.",
      "7. כל US עומד בכללי INVEST.",
      "",
      "הפיצ'ר: " + this.clean(input.text),
      "משתמש עיקרי: " + (this.clean(input.role) || "משתמש"),
      "הערך העסקי ללקוח: " + (this.clean(input.value) || "[לא צוין]"),
      "האם נדרש UI/UX: " + (input.ui ? "כן" : "לא"),
      "",
      draft ? "טיוטה ראשונה באותו פורמט (שפר/י אותה, אפשר להוסיף, לאחד ולפצל):\n" + this.csv(draft).replace(/^\uFEFF/, "") + "\n" : "",
      "צורת התשובה (חובה, כדי שהמערכת תקלוט אותה):",
      "א. סיכום קצר בעברית, עד 5 שורות.",
      "ב. קובץ CSV להורדה בשם azuri-breakdown.csv. אם אי אפשר ליצור קובץ, כתוב/כתבי את כל תוכן ה-CSV בבלוק קוד אחד שמתחיל ב-```csv.",
      "",
      "כללי ה-CSV:",
      "- השורה הראשונה בדיוק כך: " + this.CSV_HEAD.join(","),
      "- שורה אחת לכל User Story, בלי שורות ריקות ובלי עמודות נוספות. מפריד: פסיק. כל תא בתוך מירכאות כפולות.",
      "- Description: המשפט המלא \"כ[משתמש], אני רוצה [פעולה] כך ש[ערך]\".",
      "- Story Points: מספר בלבד, 2 ומעלה. Priority: מספר בלבד, 1 עד 4.",
      "- Splitting Pattern: בדיוק אחת מהתבניות שלמעלה.",
      "- Acceptance Criteria, Positive Tests, Negative Tests, Tasks: כל פריט בשורה נפרדת בתוך התא, בלי מספור. בדיוק 3 בדיקות חיוביות ו-3 שליליות.",
      "- Tasks: \"פיתוח: ...\", \"בדיקות QA: ...\"" + (input.ui ? ", \"עיצוב UI/UX: ...\"" : "") + ".",
      input.ui ? "- UI/UX: המסכים, סדר השדות והכפתורים של ה-US הזה." : "- UI/UX: ריק.",
      "- מירכאות כפולות רגילות בלבד (\"), לא מירכאות מעוצבות. מירכאות בתוך טקסט (למשל דו\"ח) כותבים פעמיים: דו\"\"ח.",
      "- לא JSON, לא טבלת Markdown ולא טקסט בתוך ה-CSV.",
      "לפני השליחה: בדוק/בדקי שהשורה הראשונה זהה בדיוק לשורת הכותרות שלמעלה, ושלכל שורה יש 10 תאים."
    ].join("\n");
  },
  strip(b) { return {feature: {title: b.feature.title, value: b.feature.value, ui: b.feature.ui}, role: b.role, stories: b.stories.map(s => ({title: s.title, asA: s.asA, iWant: s.iWant, soThat: s.soThat, pattern: s.pattern, sp: s.sp, priority: s.priority, acceptance: s.acceptance, positive: s.positive, negative: s.negative, tasks: s.tasks})), uiPrompt: b.uiPrompt}; },
  /* Accepts the AI's answer (JSON, possibly wrapped in text or a code block) and normalises it. */
  /* Any answer: a CSV (the requested format), or JSON (older prompt, agents). */
  parse(text, input) {
    const s = this.tidy(text);
    if (!s.trim()) throw new Error("לא הודבק כלום.");
    const json = /[{\[]\s*"(feature|role|stories|userStories)"/.test(s);
    if (this.findCsvHeader(s) >= 0) { try { return this.fromCsv(s, input); } catch (e) { if (!json) throw e; } }
    if (json) return this.parseJson(s, input);
    throw new Error("לא מצאתי בתשובה פירוק במבנה של אז'ורי: חסרה שורת הכותרות " + this.CSV_HEAD.slice(0, 3).join(", ") + "... אפשר להעתיק \"בקשת תיקון\" ולשלוח אותה לאותו AI.");
  },
  /* Chat tools turn quotes into typographic ones and add invisible marks when text is copied from the screen. */
  tidy(text) {
    return String(text || "").replace(/^\uFEFF/, "").replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069]/g, "")
      .replace(/[\u201C\u201D\u201E\u201F\u2033\u05F4\uFF02]/g, '"').replace(/[\u2018\u2019\u201A\u201B]/g, "'").replace(/\u00A0/g, " ");
  },
  /* A short message for the same AI chat when its answer did not fit the format. */
  fixPrompt() {
    return [
      "התשובה לא במבנה שהמערכת קולטת. החזר/י את אותו פירוק בדיוק, רק כ-CSV, בלי שום טקסט אחר:",
      "- קובץ azuri-breakdown.csv להורדה, או בלוק קוד אחד שמתחיל ב-```csv.",
      "- השורה הראשונה בדיוק כך: " + this.CSV_HEAD.join(","),
      "- שורה אחת לכל User Story. מפריד: פסיק. כל תא בתוך מירכאות כפולות רגילות (\"), לא מירכאות מעוצבות.",
      "- Story Points ו-Priority: מספר בלבד. בתאים עם כמה פריטים: כל פריט בשורה נפרדת בתוך התא.",
      "- לא JSON, לא טבלה, לא Markdown."
    ].join("\n");
  },

  /* ---------- CSV / table import ---------- */
  COLS: {
    title: /^(us\s*name|name|title|user\s*story|שם|כותרת|שם\s*(ה-?)?us|סיפור)/i,
    desc: /^(description|תיאור|תאור|ניסוח)/i,
    acceptance: /^(acceptance|תנאי\s*קבלה|קריטריונים)/i,
    sp: /^(story\s*points?|sp\b|נקודות)/i,
    priority: /^(priority|עדיפות)/i,
    pattern: /^(splitting|pattern|תבנית)/i,
    positive: /^(positive|בדיקות\s*חיוביות|חיוביות)/i,
    negative: /^(negative|בדיקות\s*שליליות|שליליות)/i,
    tasks: /^(tasks?|משימות)/i,
    ui: /^(ui|ux|מסכים|עיצוב)/i
  },
  colKey(h) {
    h = this.clean(String(h || "").replace(/^\uFEFF/, "").replace(/^["']|["']$/g, ""));
    if (!h || h.length > 40 || /[{}\[\]]|":/.test(h)) return null;          // a header is a short name, not JSON
    return Object.keys(this.COLS).find(k => this.COLS[k].test(h)) || null;
  },
  /* The header line: at least 3 known column names, split by comma, semicolon, tab or | (Markdown table). */
  findCsvHeader(s) {
    const lines = String(s).split(/\r?\n/);
    return lines.findIndex(l => [",", ";", "\t", "|"].some(d => l.split(d).filter(c => this.colKey(c.replace(/[*`]/g, ""))).length >= 3));
  },
  /* RFC 4180, forgiving: a stray quote inside a quoted cell (דו"ח) is kept as text. */
  splitCsv(text, delim) {
    const rows = []; let row = [], cell = "", q = false, i = 0;
    const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
          let j = i + 1; while (text[j] === " ") j++;
          if (j >= n || text[j] === delim || text[j] === "\n" || text[j] === "\r") { q = false; i = j; continue; }
          cell += '"'; i++; continue;
        }
        cell += c; i++; continue;
      }
      if (c === '"' && !cell.trim()) { q = true; cell = ""; i++; continue; }
      if (c === delim) { row.push(cell); cell = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
      cell += c; i++;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows;
  },
  fromCsv(text, input) {
    let s = this.tidy(text);
    const lines = s.split(/\r?\n/), h = this.findCsvHeader(s);
    if (/^\s*\|/.test(lines[h])) {                     // a Markdown table: | US Name | Description | ...
      const rows = lines.slice(h).filter(l => /^\s*\|/.test(l) && !/^\s*\|?\s*:?-{3,}/.test(l))
        .map(l => l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim().replace(/^\*\*|\*\*$/g, "").replace(/<br\s*\/?>/gi, "\n")));
      return this.fromRows(rows, input);
    }
    s = lines.slice(h).join("\n");
    s = s.replace(/\n```[\s\S]*$/, "");                     // end of a ```csv block
    const head = lines[h];
    const delim = [",", ";", "\t"].map(d => [d, head.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    return this.fromRows(this.splitCsv(s, delim), input);
  },
  /* rows[0] is the header. Used for CSV text and for Excel sheets. */
  fromRows(rows, input) {
    rows = (rows || []).filter(r => r && r.some(c => this.clean(c)));
    const hi = rows.findIndex(r => r.filter(c => this.colKey(c)).length >= 3);
    if (hi < 0) throw new Error("לא מצאתי את שורת הכותרות (US Name, Description, Acceptance Criteria...). ודאו שזה הקובץ שה-AI יצר.");
    const idx = {}; rows[hi].forEach((c, i) => { const k = this.colKey(String(c).replace(/[*`]/g, "")); if (k && idx[k] === undefined) idx[k] = i; });
    if (idx.title === undefined && idx.desc === undefined) throw new Error("בקובץ חסרות העמודות US Name ו-Description.");
    const cell = (r, k) => idx[k] === undefined ? "" : String(r[idx[k]] == null ? "" : r[idx[k]]);
    const list = v => String(v || "").split(/\r?\n|\s*\|\s*|;\s*(?=\S)/).map(x => this.clean(x.replace(/^\s*(?:\d+[.)]|[-•*–])\s*/, ""))).filter(Boolean);
    const role = this.clean(input && input.role) || "משתמש";
    const ui = [];
    const stories = rows.slice(hi + 1).map(r => {
      const d = this.clean(cell(r, "desc"));
      const m = /^כ-?\s*([^,]{1,40}),\s*אני\s+רוצה\s+(.+?)(?:,?\s+(?:כך\s+ש-?|כדי\s+ש-?|כדי\s+)(.+))?$/.exec(d);
      const u = this.clean(cell(r, "ui")); if (u) ui.push(u);
      const tasks = list(cell(r, "tasks")).map(t => {
        const hm = /\(?\s*(\d+(?:\.\d+)?)\s*(?:ש(?:עות|')?|h|hours?)\s*\)?\s*$/i.exec(t);
        return hm ? {title: this.clean(t.slice(0, hm.index)).replace(/[-–:,]\s*$/, ""), hours: Number(hm[1])} : {title: t};
      });
      return {title: this.clean(cell(r, "title")), asA: m ? this.clean(m[1]) : role, iWant: m ? this.clean(m[2]) : d, soThat: m && m[3] ? this.clean(m[3]).replace(/[.]$/, "") : "",
        pattern: this.clean(cell(r, "pattern")), sp: parseFloat(cell(r, "sp")) || 2, priority: parseFloat(cell(r, "priority")) || 2,
        acceptance: list(cell(r, "acceptance")), positive: list(cell(r, "positive")), negative: list(cell(r, "negative")), tasks: tasks.length ? tasks : null, _ui: u};
    }).filter(x => x.title || x.iWant);
    if (!stories.length) throw new Error("בקובץ אין שורות של User Stories.");
    const b = {feature: {title: this.firstSentence((input && input.text) || stories[0].title, 70), value: this.clean(input && input.value), ui: ui.length > 0 || !!(input && input.ui)},
      role: stories[0].asA || role, uiPrompt: stories.filter(s => s._ui).map(s => "- " + (s.title || "US") + ": " + s._ui).join("\n"), stories};
    return this.finish(b, "ai");
  },

  parseJson(text, input) {
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
    if (!tries.length) throw new Error("לא מצאתי בתשובה פירוק במבנה של אז'ורי (שורת כותרות שמתחילה ב-US Name). העלו את קובץ ה-CSV שה-AI יצר, או הדביקו את כל התוכן שלו.");
    let lastErr = null;
    for (const t of tries) {
      const body = t.trim(), a2 = body.indexOf("{"), z2 = body.lastIndexOf("}");
      if (a2 < 0 || z2 <= a2) continue;
      let o;
      const raw = body.slice(a2, z2 + 1);
      try { o = JSON.parse(raw); }
      catch (e) {
        try { o = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1").replace(/^\s*\/\/.*$/gm, "")); }   // trailing commas, comment lines
        catch (e2) { lastErr = e; continue; }
      }
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
    const head = this.CSV_HEAD;
    const rows = b.stories.map((s, i) => [s.title, this.sentence(s), s.acceptance.join("\n"), s.sp, s.priority, s.pattern, s.positive.join("\n"), s.negative.join("\n"), s.tasks.map(t => t.title).join("\n"), s._ui || (i === 0 && !b.stories.some(x => x._ui) ? b.uiPrompt || "" : "")]);
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
