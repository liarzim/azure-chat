# Azure Chat 2

כלי לצוות לשליפה ועדכון של Work Items ב-Azure DevOps (GOI-Finance / Portfolio Merkava).
אתר סטטי בלבד, בלי שרת. הדפדפן של המשתמש מדבר ישירות עם Azure DevOps עם ה-PAT של המשתמש, כך שכל אחד רואה ומעדכן רק לפי ההרשאות שלו.

## מבנה

| קובץ | תפקיד |
|---|---|
| `index.html` | המסך |
| `css/app.css` | עיצוב |
| `js/core.js` | שליפה, טבלה, תמונות, Excel, העתקה (מבוסס על Azure Chat 1.3) |
| `team-config.json` | הגדרות הצוות: שדות חובה ותבנית Description. נערך ממסך "הגדרות צוות" |
| `vercel.json` | כותרות אבטחה ומטמון לפרסום ב-Vercel |

## פרסום

כל push ל-`main` מתפרסם אוטומטית ב-Vercel.

## הגדרות צוות

מסך "הגדרות צוות" שומר את `team-config.json` ישירות ל-GitHub (דורש GitHub token עם הרשאת Contents: Read and write ל-repo הזה בלבד). אחרי השמירה Vercel מפרסם מחדש, ותוך כדקה כל הצוות מקבל את ההגדרות.
