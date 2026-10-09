# פירוק פיצ'ר: חיבור לסוכן קיים

אז'ורי יכול לשלוח את הפיצ'ר לסוכן (שירות AI) שהארגון כבר מפעיל, ולהציג את הפירוק שהוא מחזיר.

## הפעלה

ב-`team-config.json`:

```json
"breakdownAgent": {"url": "https://agent.example.org/breakdown", "label": "פירוק עם הסוכן"}
```

- הכתובת חייבת להתחיל ב-`https://`. כתובות של Azure DevOps נחסמות בכוונה.
- הסוכן צריך לאפשר CORS מהכתובת של אז'ורי (`https://azure-chat-lake.vercel.app`), לבקשות `POST` עם `Content-Type: application/json`.
- הבקשה נשלחת **בלי טוקן ובלי cookies** (`credentials: "omit"`). אם הסוכן דורש הזדהות, צריך להוסיף מנגנון נפרד, לא את ה-PAT של Azure.

## הבקשה (POST, JSON)

```json
{
  "text": "תיאור הפיצ'ר כפי שהמשתמש כתב",
  "role": "חשב",
  "value": "הערך העסקי ללקוח",
  "ui": true,
  "draft": { "...": "הפירוק של הכללים הפנימיים, באותו מבנה כמו התשובה" }
}
```

## התשובה (JSON)

```json
{
  "feature": {"title": "שם הפיצ'ר", "value": "הערך", "ui": true},
  "role": "חשב",
  "stories": [
    {
      "title": "צפייה במוסדות שקיבלו תמיכה",
      "asA": "חשב",
      "iWant": "לצפות במוסדות שקיבלו תמיכה",
      "soThat": "אדע כמה מוסדות קיבלו תמיכה",
      "pattern": "תפעול/פעולות",
      "sp": 2,
      "priority": 1,
      "acceptance": ["..."],
      "positive": ["...", "...", "..."],
      "negative": ["...", "...", "..."],
      "tasks": [{"title": "פיתוח: ..."}]
    }
  ],
  "uiPrompt": "פירוט מסכים, שדות וכפתורים (ריק אם לא נדרש UI/UX)"
}
```

- `pattern`: אחת מתבניות ה-Skill: סוגי ערך למשתמש, מסלולי שימוש, תפעול/פעולות, פיתוח אינקרמנטלי (מפשוט למורכב), דחיית מימוש דרישות לא פונקציונליות, Spike Story, Workflow.
- אז'ורי מתקן ערכים חריגים: `sp` לפחות 2, `priority` בין 1 ל-4. בלי `tasks` נוצרים Tasks ברירת מחדל (פיתוח, בדיקות QA, ועיצוב UI/UX כשנדרש).
- שמות חלופיים שמתקבלים: `userStories`, `storyPoints`, `acceptanceCriteria`, `positiveTests`, `negativeTests`, וגם שמות העמודות של ה-CSV (`US Name`, `Story Points` וכו').
- עד 40 User Stories.

אותו מבנה משמש גם את "שיפור עם AI" (העתק והדבק).
