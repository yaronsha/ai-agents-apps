// What can be known before going to each stop: hours, closed days, fees, how to pay, and local rules.
// Gathered on 2026-10-16 from web search over travel guides and Thai news (the official pages, where
// there are any, could not be opened from where this was written). Guides often disagree; where they
// do, the text says so. The worker's place check (worker/src/places.ts) looks for changes to these
// facts and for closures, and turns them into alerts. Keyed like PLACES, so PLACE_ALIAS applies.
import { PLACE_ALIAS } from "./places";

export interface PlaceFacts {
  /** The place's own name for alert titles, where the stop's name also covers other plans. */
  nameHe?: string;
  /** Opening hours in Thai time, as the guides give them. */
  hours?: { open: string; close: string; lastEntry?: string };
  /** Hours as shown, when they need words ("לרוב 06:00-18:00, יש מדריכים שכותבים עד 20:00"). Defaults to `hours`. */
  hoursHe?: string;
  /** Weekdays (0 = Sunday) on which the place, or the part named in `closedNoteHe`, is closed. */
  closedOn?: number[];
  /** What is closed on `closedOn`, as a sentence. */
  closedNoteHe?: string;
  feeHe?: string;
  payHe?: string;
  /** Anything else worth knowing ahead: booking, timing, local rules, recent closures. */
  notesHe?: string[];
  /** Official site or page with notices. Also handed to the daily web check. */
  officialUrls?: string[];
  /** False keeps the place out of the daily web check (the flight check already covers the airport). */
  watch?: boolean;
  /** YYYY-MM-DD the facts were gathered. */
  checked: string;
}

const CHECKED = "2026-10-16";
const CASH = "מזומן בבאט. בקופות של אתרים ומקדשים כמעט לא מקבלים כרטיס.";
const NATIONAL_PARKS = "https://portal.dnp.go.th/p/nationalpark";

export const PLACE_FACTS: Record<string, PlaceFacts> = {
  "cnx-arrive": {
    hoursHe: "פתוח 24 שעות",
    notesHe: [
      "משיכה מכספומט בתאילנד עולה 220-250 באט עמלה, בלי קשר לסכום. עדיף למשוך מעט פעמים וסכומים גדולים.",
      "כשמכשיר הכרטיס שואל באיזה מטבע לחייב, לבחור באט.",
    ],
    officialUrls: ["https://chiangmai.airportthai.co.th"],
    watch: false,
    checked: CHECKED,
  },
  "maya-mall": {
    hours: { open: "11:00", close: "22:00" },
    hoursHe: "בערך 10:00 או 11:00 עד 22:00 (המדריכים חלוקים)",
    payHe: "כרטיס אשראי מתקבל ברוב החנויות.",
    checked: CHECKED,
  },
  "doi-suthep": {
    nameHe: "מקדש דוי סוטפ",
    hours: { open: "06:00", close: "18:00" },
    hoursHe: "לרוב 06:00-18:00. יש מדריכים שכותבים עד 20:00 ואפילו 21:00",
    feeHe: "30 באט לזר (יש שכותבים 50). הרכבל 20 באט לכיוון.",
    payHe: CASH,
    notesHe: ["כתפיים וברכיים מכוסות. בכניסה משכירים סרונג."],
    checked: CHECKED,
  },
  "twin-pagodas": {
    hours: { open: "05:00", close: "18:00", lastEntry: "16:00" },
    hoursHe: "הפארק 05:00-18:00. לרוב האתרים בפנים הכניסה האחרונה ב-16:00",
    feeHe: "כניסה לפארק הלאומי דוי אינתנון 300 באט לזר. לפגודות דמי כניסה נפרדים.",
    payHe: CASH,
    notesHe: ["כרטיס הפארק תקף לכל היום, לשמור אותו לכל העצירות בהר."],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "ang-ka": {
    hours: { open: "06:00", close: "18:00" },
    feeHe: "כלול בכרטיס הפארק.",
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "pha-dok-siew": {
    hours: { open: "06:00", close: "18:00", lastEntry: "16:00" },
    feeHe: "כלול בכרטיס הפארק. מדריך מקומי חובה, לפי בלוג טיולים כ-200 באט לקבוצה.",
    payHe: CASH,
    notesHe: [
      "השביל נסגר כמעט כל שנה בעונת הגשמים (יוני-אוקטובר) ונפתח ב-1 בנובמבר.",
      "בספטמבר 2026 השביל ומפל Mae Ya נסגרו זמנית אחרי שיטפונות. הבדיקה היומית תבדוק שנפתח.",
    ],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  wachirathan: {
    hours: { open: "06:00", close: "18:00" },
    feeHe: "כלול בכרטיס הפארק.",
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "old-city-temples": {
    hours: { open: "06:00", close: "18:00" },
    hoursHe: "לרוב 06:00-18:00 (ואט צ'די לואנג לפעמים עד מאוחר יותר)",
    feeHe: "ואט פרה סינג וואט צ'די לואנג: 40-50 באט לזר בכל אחד. ואט פאן טאו לרוב בחינם.",
    payHe: CASH,
    notesHe: ["כתפיים וברכיים מכוסות. חולצים נעליים לפני האולם."],
    checked: CHECKED,
  },
  "lantern-festival": {
    feeHe: "כרטיסים 4,880-15,880 באט לפי סוג, כולל הסעה, ארוחה ושני פנסים.",
    notesHe: [
      "האירוע ב-24 וב-25 בנובמבר 2026. ההפרחה בערך ב-20:15.",
      "לפי מדריכים ההסעות יוצאות בין 13:00 ל-14:30. לבדוק את שעת האיסוף שכתובה בכרטיס.",
      "לפי מדריך גרמני הכרטיסים ל-2026 כבר אזלו. לא לקנות מאתר לא מוכר.",
      "לוח הזמנים המדויק מתפרסם לרוב כשישה שבועות לפני.",
    ],
    officialUrls: ["https://yipengchiangmailanternfestival.com", "https://faceticket.net"],
    checked: CHECKED,
  },
  "mok-fa": {
    hours: { open: "08:00", close: "16:30" },
    hoursHe: "לרוב 08:00-16:30 (יש שכותבים 07:00-18:00)",
    feeHe: "100 באט לזר (פארק דוי סוטפ-פוי). חניה 30 באט.",
    payHe: CASH,
    notesHe: ["המפל נסגר זמנית ב-29.9.2026 אחרי גשמים חזקים. הבדיקה היומית תבדוק שנפתח."],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "pai-loy-krathong": {
    notesHe: ["רוב המקורות שמים את הלילה המרכזי של לוי קראטונג ב-24.11, יש שכותבים 25.11."],
    payHe: "קראטונג בדוכנים, במזומן.",
    checked: CHECKED,
  },
  "doi-kiew-lom": {
    feeHe: "לא נמצאו דמי כניסה.",
    checked: CHECKED,
  },
  "tham-lod": {
    hours: { open: "08:00", close: "17:30" },
    hoursHe: "בערך 08:00-17:30 (במקור ישן: עד 16:00)",
    feeHe: "מדריכה עם פנס חובה: כ-150 באט לקבוצה של עד 3. רפסודת במבוק: כ-400 באט לעד 3. ייתכן גם כרטיס לשמורה.",
    payHe: CASH,
    notesHe: ["בעונת הגשמים מפלס המים משנה את המסלול. בסוף נובמבר זה לרוב בסדר."],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "pai-canyon": {
    hoursHe: "פתוח תמיד",
    feeHe: "בחינם. לפעמים מבקשים תרומה קטנה לניקיון.",
    checked: CHECKED,
  },
  "pai-walking-street": {
    hours: { open: "17:00", close: "22:30" },
    hoursHe: "כל ערב, בערך 17:00-22:30",
    payHe: CASH,
    checked: CHECKED,
  },
  "yun-lai": {
    hoursHe: "מהזריחה עד השקיעה",
    feeHe: "20 באט לאדם.",
    payHe: "מזומן.",
    checked: CHECKED,
  },
  "wat-ban-den": {
    hours: { open: "08:00", close: "17:00" },
    hoursHe: "לפי אתר אחד 08:00-17:00, לא מאומת",
    feeHe: "בחינם, תרומה מתקבלת בברכה.",
    notesHe: ["כתפיים מכוסות ומכנסיים או חצאית ארוכים."],
    checked: CHECKED,
  },
  "chiang-dao-cave": {
    hours: { open: "08:00", close: "17:00" },
    hoursHe: "07:00 או 08:00 עד 17:00",
    feeHe: "40 באט לזר. מדריך עם פנס לחלקים החשוכים: 200-300 באט לקבוצה.",
    payHe: CASH,
    notesHe: ["רק שני אולמות מוארים. לשלושה האחרים נכנסים עם מדריך."],
    checked: CHECKED,
  },
  "doi-chang-coffee": {
    nameHe: "מטע Doi Chaang",
    closedOn: [0, 6],
    closedNoteHe: "לפי מפעיל טיולים, סיורי המטע והמפעל של Doi Chaang Coffee מתקיימים רק בימים ב'-ה' ובשישי בבוקר. בתי הקפה פתוחים גם בסוף השבוע.",
    notesHe: ["חלופה שפתוחה כל השבוע לפי אותו מפעיל: Leehu Coffee Farm."],
    checked: CHECKED,
  },
  "khun-korn": {
    hours: { open: "08:00", close: "17:00", lastEntry: "15:30" },
    hoursHe: "08:00-17:00. כניסה אחרונה לשביל בערך ב-15:30 (מקור אחד)",
    feeHe: "בחינם (פארק יער, לא פארק לאומי).",
    notesHe: ["כ-30-45 דקות הליכה לכל כיוון. השביל נסגר לפעמים אחרי גשם חזק."],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "white-temple": {
    hours: { open: "08:00", close: "17:30", lastEntry: "17:00" },
    feeHe: "200 באט לזר מינואר 2026. מגיל 70 ומעלה בחינם.",
    payHe: "לא ברור אם מקבלים כרטיס. כדאי מזומן.",
    notesHe: ["מבקרים מעל גיל 70 נכנסים בחינם, כדאי להביא דרכון.", "סרונג מושאל בחינם בכניסה."],
    checked: CHECKED,
  },
  "cr-walking-street": {
    hours: { open: "17:00", close: "22:00" },
    payHe: "רוב הדוכנים מזומן בלבד. יש כספומט ליד מגדל השעון.",
    notesHe: [
      "שוק הרחוב הגדול של צ'יאנג ראי (רחוב Thanalai) הוא בשבת. ביום ראשון יש שוק קטן יותר ברחוב San Khong Noi, ליד ואט צ'טופון.",
    ],
    checked: CHECKED,
  },
  "kok-boat": {
    feeHe: "המחירים לא אחידים. לפי מדריכים סירה פרטית לכפר רואם מית עולה כ-900-1,000 באט לכיוון. לסגור בקופה מחיר, משך ומסלול לפני שעולים.",
    payHe: CASH,
    checked: CHECKED,
  },
  ruammit: {
    hours: { open: "08:00", close: "17:00" },
    notesHe: ["לא נמצאו דמי כניסה לכפר. רכיבה על פילים מוצעת שם, ואפשר לוותר."],
    payHe: CASH,
    checked: CHECKED,
  },
  "pha-soet": {
    nameHe: "המעיינות ב-Pha Soet",
    hours: { open: "08:30", close: "18:00" },
    hoursHe: "בערך 08:30-18:00",
    closedOn: [1, 4],
    closedNoteHe: "לפי כמה מדריכים הבריכה המינרלית סגורה בימי שני וחמישי לניקוי. טבילת הרגליים בבריכות הפתוחות כנראה אפשרית.",
    payHe: CASH,
    notesHe: ["המקום נפגע בשיטפונות של אוקטובר 2024 ועדיין משתקם, ייתכן שחלק מהמתקנים סגורים."],
    officialUrls: [NATIONAL_PARKS],
    checked: CHECKED,
  },
  "kok-river-lunch": {
    hours: { open: "09:00", close: "22:00" },
    notesHe: ["כדאי להזמין מקום. טלפון ‎+66 81 984 2925."],
    officialUrls: ["https://www.chivitthammada.com"],
    checked: CHECKED,
  },
  "blue-temple": {
    hours: { open: "07:00", close: "20:00" },
    feeHe: "בחינם.",
    notesHe: ["כתפיים וברכיים מכוסות."],
    checked: CHECKED,
  },
  "cr-night-bazaar": {
    hours: { open: "18:00", close: "23:00" },
    payHe: CASH,
    checked: CHECKED,
  },
  "akha-kitchen": {
    notesHe: [
      "נפגשים ב-09:00 ליד מגדל השעון של צ'יאנג ראי. לפי תנאי ההזמנה, איחור של יותר מ-10 דקות נחשב אי-הגעה.",
      "מי שמצטרף ולא מבשל משלם במקום 750 באט.",
      "ביטול בחינם עד 24 שעות לפני.",
    ],
    checked: CHECKED,
  },
  "cm-night-bazaar": {
    nameHe: "שוק הלילה של צ'אנג מאי",
    hours: { open: "18:00", close: "23:59" },
    hoursHe: "כל ערב, בערך 18:00 עד חצות",
    payHe: "רוב הדוכנים מזומן בלבד.",
    checked: CHECKED,
  },
};

export function placeFacts(stopId: string): PlaceFacts | undefined {
  return PLACE_FACTS[PLACE_ALIAS[stopId] ?? stopId];
}
