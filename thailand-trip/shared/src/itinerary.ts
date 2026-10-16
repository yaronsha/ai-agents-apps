// Built from "צפון תאילנד 10.8.docx" (Google Drive, version of 2026-10-16).
// Coordinates were checked on 2026-10-07 against map listings (AllTrails, Tripadvisor, Waze, Wikipedia,
// Atlas Obscura, plus codes). `npm run verify:places` re-checks them against OpenStreetMap.
import type { Day, Trip, TripPrivate } from "./types";

const days: Day[] = [
  {
    date: "2026-11-22",
    titleHe: "נחיתה, מנוחה, קניון MAYA ושקיעה בדוי סוטפ",
    lodgingId: "cm1",
    stops: [
      { id: "cnx-arrive", nameHe: "נחיתה בשדה התעופה צ'אנג מאי", nameEn: "Chiang Mai Airport", lat: 18.7668, lng: 98.9626, start: "2026-11-22T06:05", end: "2026-11-22T07:00", outdoor: false },
      { id: "maya-mall", nameHe: "קניון MAYA: מקלות הליכה מתקפלים", nameEn: "MAYA Lifestyle Shopping Center", lat: 18.8024, lng: 98.9672, start: "2026-11-22T14:45", end: "2026-11-22T15:30", outdoor: false },
      { id: "doi-suthep", nameHe: "מקדש דוי סוטפ בשקיעה", nameEn: "Wat Phra That Doi Suthep", lat: 18.805, lng: 98.9217, start: "2026-11-22T17:00", end: "2026-11-22T19:30", outdoor: true, noteHe: "עלייה ברכבל, ירידה ברגל ב-306 מדרגות הנאגה." },
    ],
    drives: [{ id: "d22-suthep", fromId: "lodging:cm1", toId: "doi-suthep", departAt: "2026-11-22T16:15" }],
    reminders: [{ id: "r22-suthep", at: "2026-11-22T15:45", textHe: "בעוד חצי שעה יוצאים לדוי סוטפ כדי להספיק את השקיעה." }],
    planB: [
      "גשם: לעלות ולרדת ברכבל ולוותר על הירידה במדרגות הנאגה, שחלקלקות ברטיבות.",
      "מעונן או גשום בשקיעה: לבקר בדוי סוטפ מחר בבוקר ולוותר על השקיעה.",
    ],
  },
  {
    date: "2026-11-23",
    titleHe: "דוי אינתנון: פגודות המלך והמלכה וטרק המפלים",
    lodgingId: "cm1",
    stops: [
      { id: "twin-pagodas", nameHe: "פגודות המלך והמלכה", nameEn: "Naphamethinidon & Naphaphonphumisiri", lat: 18.5529, lng: 98.4798, start: "2026-11-23T09:00", end: "2026-11-23T10:15", outdoor: true, highland: true, noteHe: "קר בבוקר, לפעמים פחות מ-15 מעלות." },
      { id: "ang-ka", nameHe: "שביל אנג קה ביער הערפל", nameEn: "Ang Ka Nature Trail", lat: 18.5888, lng: 98.4866, start: "2026-11-23T10:15", end: "2026-11-23T10:45", outdoor: true, highland: true },
      { id: "pha-dok-siew", nameHe: "טרק Pha Dok Siew עם מדריך קארן", nameEn: "Pha Dok Siew Trail", lat: 18.5383, lng: 98.5248, start: "2026-11-23T11:00", end: "2026-11-23T13:00", outdoor: true, highland: true },
      { id: "mae-klang-luang", nameHe: "צהריים בכפר Mae Klang Luang", nameEn: "Mae Klang Luang village", lat: 18.5275, lng: 98.5337, start: "2026-11-23T13:00", end: "2026-11-23T14:00", outdoor: false },
      { id: "wachirathan", nameHe: "מפל וצ'יראטאן", nameEn: "Wachirathan Waterfall", lat: 18.5408, lng: 98.5994, start: "2026-11-23T14:15", end: "2026-11-23T14:30", outdoor: true },
      { id: "old-city-night", nameHe: "סיור לילי בעיר העתיקה", nameEn: "Old City temples by night", lat: 18.7869, lng: 98.9866, start: "2026-11-23T19:30", end: "2026-11-23T21:30", outdoor: true },
    ],
    drives: [
      { id: "d23-inthanon", fromId: "lodging:cm1", toId: "twin-pagodas", departAt: "2026-11-23T07:00" },
      { id: "d23-back", fromId: "wachirathan", toId: "lodging:cm1", departAt: "2026-11-23T14:30" },
    ],
    reminders: [{ id: "r23-jacket", at: "2026-11-23T06:15", textHe: "יוצאים ב-07:00 לדוי אינתנון. קר בפסגה, לקחת סווטשרט." }],
    planB: [
      "גשם חזק או ערפל: לוותר על הטרק ולבקר רק בפגודות ובמפל Wachirathan שליד הכביש.",
      "תחזית גרועה לכל היום: להחליף עם הבוקר של 24.11 (סיור המקדשים בעיר).",
    ],
  },
  {
    date: "2026-11-24",
    titleHe: "מקדשי העיר העתיקה ופסטיבל הפנסים",
    lodgingId: "cm1",
    stops: [
      { id: "old-city-temples", nameHe: "ואט פרה סינג, ואט פאן טאו, ואט צ'די לואנג", nameEn: "Old City temples", lat: 18.7884, lng: 98.9819, start: "2026-11-24T09:00", end: "2026-11-24T12:00", outdoor: true },
      { id: "khao-soi", nameHe: "צהריים: קאו סוי", nameEn: "Khao Soi lunch", lat: 18.7953, lng: 98.962, start: "2026-11-24T12:00", end: "2026-11-24T13:00", outdoor: false },
      { id: "lantern-festival", nameHe: "פסטיבל הפנסים CAD Khomloy", nameEn: "CAD Khomloy Sky Lantern Festival", lat: 18.7664, lng: 99.2422, start: "2026-11-24T17:00", end: "2026-11-24T21:30", outdoor: true, noteHe: "CAD Cultural Center במחוז מאה און, כשעה נסיעה מהעיר. ההסעה יוצאת מ-CMEC או מקניון MAYA, לפי סוג הכרטיס. נקודת האיסוף ב-15:30." },
    ],
    drives: [],
    reminders: [{ id: "r24-pickup", at: "2026-11-24T14:45", textHe: "האיסוף לפסטיבל הפנסים ב-15:30. לקחת כרטיסים ודרכונים." }],
    planB: [
      "האירוע בוטל או נדחה: הפרחת פנסים ושיט קראטונג בשער טא פאה ולאורך נהר הפינג ליד גשר נווארט.",
      "לבדוק במייל את מדיניות ההחזר של מארגני הפסטיבל.",
    ],
  },
  {
    date: "2026-11-25",
    titleHe: "דרך ההרים לפאי, מפל מוק פה ולוי קראטונג",
    lodgingId: "pai",
    stops: [
      { id: "thingamajiggy", nameHe: "קפה Thingamajiggy Coffee Roaster", nameEn: "Thingamajiggy Coffee Roaster", lat: 18.95, lng: 98.95, start: "2026-11-25T09:00", end: "2026-11-25T09:30", outdoor: false, noteHe: "בית קפה בין שדות האורז של מאה רים. מיקום משוער, לבדוק במפה." },
      { id: "mok-fa", nameHe: "מפל מוק פה", nameEn: "Mok Fa Waterfall", lat: 19.1088, lng: 98.7718, start: "2026-11-25T09:30", end: "2026-11-25T11:00", outdoor: true },
      { id: "pai-memorial-bridge", nameHe: "גשר הזיכרון של פאי", nameEn: "Pai Memorial Bridge", lat: 19.2977, lng: 98.465, start: "2026-11-25T13:15", end: "2026-11-25T13:30", outdoor: true },
      { id: "pai-loy-krathong", nameHe: "לוי קראטונג על נהר פאי", nameEn: "Loy Krathong, Pai river", lat: 19.3596, lng: 98.4455, start: "2026-11-25T17:00", end: "2026-11-25T21:00", outdoor: true, noteHe: "הלילה המרכזי הוא 24.11; ב-25.11 החגיגות כנראה קטנות יותר." },
    ],
    drives: [
      { id: "d25-pai", fromId: "lodging:cm1", toId: "mok-fa", departAt: "2026-11-25T08:30" },
      { id: "d25-bridge", fromId: "mok-fa", toId: "pai-memorial-bridge", departAt: "2026-11-25T11:00" },
    ],
    reminders: [{ id: "r25-van", at: "2026-11-25T08:00", textHe: "הנהג מגיע ב-08:30. כביש 1095 מפותל מאוד, כדאי כדור נגד בחילה." }],
    planB: [
      "כביש 1095 חסום או מוצף: לעכב את היציאה ולהתייעץ עם הנהג על מצב הכביש.",
      "גשם חזק: השביל למפל מוק פה חלקלק, להסתפק בתצפית מתחילת השביל.",
      "גשם בערב: לחגוג בשוק הלילה (Walking Street) ולשוט קראטונג כשהגשם נחלש.",
    ],
  },
  {
    date: "2026-11-26",
    titleHe: "מערת תאם לוד ושקיעה בקניון פאי",
    lodgingId: "pai",
    stops: [
      { id: "doi-kiew-lom", nameHe: "תצפית דוי קיו לו", nameEn: "Doi Kiew Lom Viewpoint", lat: 19.4458, lng: 98.3192, start: "2026-11-26T10:30", end: "2026-11-26T10:50", outdoor: true },
      { id: "tham-lod", nameHe: "מערת תאם לוד", nameEn: "Tham Lod Cave", lat: 19.5664, lng: 98.2789, start: "2026-11-26T11:30", end: "2026-11-26T14:00", outdoor: false },
      { id: "pai-canyon", nameHe: "שקיעה בקניון פאי", nameEn: "Pai Canyon", lat: 19.3076, lng: 98.4558, start: "2026-11-26T16:30", end: "2026-11-26T18:15", outdoor: true },
      { id: "pai-walking-street", nameHe: "שוק הלילה של פאי", nameEn: "Pai Walking Street", lat: 19.3589, lng: 98.4406, start: "2026-11-26T20:00", end: "2026-11-26T22:00", outdoor: true },
    ],
    drives: [
      { id: "d26-thamlod", fromId: "lodging:pai", toId: "doi-kiew-lom", departAt: "2026-11-26T09:30" },
      { id: "d26-back", fromId: "tham-lod", toId: "pai-canyon", departAt: "2026-11-26T14:00" },
    ],
    reminders: [],
    planB: [
      "גשם בשקיעה: לצפות מתצפית Yun Lai או מבית קפה מקורה. שבילי החימר בקניון חלקלקים ומסוכנים ברטיבות.",
      "שייט הרפסודות במערה מושבת בגלל מים גבוהים: סיור רגלי בלבד, או כפר באן ג'אבו והמרק התלוי.",
    ],
  },
  {
    date: "2026-11-27",
    titleHe: "תצפית יון לאי, הכפר הסיני ומעבר לצ'אנג דאו",
    lodgingId: "cd",
    stops: [
      { id: "yun-lai", nameHe: "תצפית יון לאי והכפר הסיני סנטיצ'ון", nameEn: "Yun Lai Viewpoint", lat: 19.369, lng: 98.3954, start: "2026-11-27T09:15", end: "2026-11-27T10:30", outdoor: true },
      { id: "rak-chang", nameHe: "תצפית Rak Chang", nameEn: "Rak Chang Viewpoint", lat: 19.25, lng: 98.55, start: "2026-11-27T11:30", end: "2026-11-27T11:50", outdoor: true, noteHe: "על כביש 1095, כשעה מפאי. מיקום משוער, לבדוק במפה." },
      { id: "wat-ban-den", nameHe: "מקדש ואט באן דן", nameEn: "Wat Ban Den", lat: 19.2195, lng: 98.9486, start: "2026-11-27T14:00", end: "2026-11-27T15:30", outdoor: true, noteHe: "לחלופין פארק דנטוואדה. מיקום משוער, לבדוק במפה." },
    ],
    drives: [
      { id: "d27-yunlai", fromId: "lodging:pai", toId: "yun-lai", departAt: "2026-11-27T09:00" },
      { id: "d27-rakchang", fromId: "yun-lai", toId: "rak-chang", departAt: "2026-11-27T10:30" },
      { id: "d27-banden", fromId: "rak-chang", toId: "wat-ban-den", departAt: "2026-11-27T11:50" },
      { id: "d27-chiangdao", fromId: "wat-ban-den", toId: "lodging:cd", departAt: "2026-11-27T15:45" },
    ],
    reminders: [],
    planB: [
      "גשם או ערפל: לוותר על תצפית Rak Chang ולנסוע ישר לואט באן דן.",
      "גשם חזק בצהריים: לבקר בואט באן דן רק באולמות המקורים, או לנסוע ישר לצ'אנג דאו.",
    ],
  },
  {
    date: "2026-11-28",
    titleHe: "מערת צ'אנג דאו ומטעי הקפה בדוי צ'אנג",
    lodgingId: "dc",
    stops: [
      { id: "chiang-dao-cave", nameHe: "מקדש מערת צ'אנג דאו", nameEn: "Wat Tham Chiang Dao", lat: 19.3936, lng: 98.9286, start: "2026-11-28T09:00", end: "2026-11-28T11:00", outdoor: false },
      { id: "doi-chang-coffee", nameHe: "מטעי הקפה ותצפיות בדוי צ'אנג", nameEn: "Doi Chang coffee farms", lat: 19.8165, lng: 99.5625, start: "2026-11-28T14:00", end: "2026-11-28T18:00", outdoor: true, highland: true },
    ],
    drives: [{ id: "d28-doichang", fromId: "chiang-dao-cave", toId: "doi-chang-coffee", departAt: "2026-11-28T11:00" }],
    reminders: [],
    planB: ["ערפל כבד או גשם בדוי צ'אנג: לעלות רק באור יום ולהישאר בבתי הקפה הקרובים לכביש."],
  },
  {
    date: "2026-11-29",
    titleHe: "מפל קון קורן, המקדש הלבן ושוק יום ראשון",
    lodgingId: "cr",
    stops: [
      { id: "khun-korn", nameHe: "טרק מפל קון קורן", nameEn: "Khun Korn Waterfall", lat: 19.876, lng: 99.6264, start: "2026-11-29T09:30", end: "2026-11-29T12:30", outdoor: true },
      { id: "white-temple", nameHe: "המקדש הלבן", nameEn: "Wat Rong Khun", lat: 19.8243, lng: 99.7633, start: "2026-11-29T14:30", end: "2026-11-29T15:30", outdoor: true, noteHe: "לפני כן ארוחת צהריים באחת המסעדות ליד המקדש, 13:00-14:30." },
      { id: "cr-walking-street", nameHe: "שוק יום ראשון בצ'יאנג ראי", nameEn: "Chiang Rai Sunday Walking Street", lat: 19.9015, lng: 99.819, start: "2026-11-29T19:30", end: "2026-11-29T22:00", outdoor: true },
    ],
    drives: [
      { id: "d29-khunkorn", fromId: "lodging:dc", toId: "khun-korn", departAt: "2026-11-29T08:30" },
      { id: "d29-white", fromId: "khun-korn", toId: "white-temple", departAt: "2026-11-29T12:30" },
      { id: "d29-chiangrai", fromId: "white-temple", toId: "lodging:cr", departAt: "2026-11-29T15:30" },
    ],
    reminders: [{ id: "r29-boat", at: "2026-11-29T21:00", textHe: "מחר יוצאים ב-10:00 לשייט בנהר הקוק. לקחת בננות ובוטנים לקופים ומגבת קטנה לטבילת הרגליים." }],
    planB: ["גשם בטרק קון קורן: השביל חלקלק, להסתפק בחלק הראשון או לדלג ולהגיע מוקדם לצ'יאנג ראי."],
  },
  {
    date: "2026-11-30",
    titleHe: "שייט בנהר הקוק, כפרי השבטים והמקדש הכחול",
    lodgingId: "cr",
    stops: [
      { id: "kok-boat", nameHe: "שייט פרטי בנהר הקוק וקופים במצוק", nameEn: "C.R. Pier", lat: 19.9216, lng: 99.8183, start: "2026-11-30T10:15", end: "2026-11-30T11:00", outdoor: true, noteHe: "סירה פרטית ל-3 שעות מהקופה ברציף. לבקש מהנהג להסביר למשיט: קופים במצוק, כפר הקארן, כפר הלאהו, וירידה במעיינות Pha Soet. מיקום הרציף משוער." },
      { id: "ruammit", nameHe: "כפר הקארן Ruammit וכפר הלאהו", nameEn: "Ban Ruam Mit", lat: 19.938, lng: 99.66, start: "2026-11-30T11:00", end: "2026-11-30T12:30", outdoor: true, noteHe: "מיקום משוער." },
      { id: "pha-soet", nameHe: "טבילת רגליים ובישול ביצים ב-Pha Soet", nameEn: "Pha Soet Hot Spring", lat: 19.94, lng: 99.632, start: "2026-11-30T12:30", end: "2026-11-30T13:15", outdoor: true, noteHe: "הנהג מחכה כאן עם הוואן ב-13:15. מיקום משוער." },
      { id: "kok-river-lunch", nameHe: "צהריים ב-Chivit Thamma Da על נהר הקוק", nameEn: "Chivit Thamma Da", lat: 19.9175, lng: 99.8295, start: "2026-11-30T13:30", end: "2026-11-30T15:00", outdoor: false, noteHe: "לבקש מהנהג להזמין מקום מראש ל-13:35. מיקום משוער, לבדוק במפה." },
      { id: "blue-temple", nameHe: "המקדש הכחול", nameEn: "Wat Rong Suea Ten", lat: 19.9218, lng: 99.8421, start: "2026-11-30T17:00", end: "2026-11-30T18:15", outdoor: true },
      { id: "cr-night-bazaar", nameHe: "שוק הלילה של צ'יאנג ראי והוט פוט", nameEn: "Chiang Rai Night Bazaar", lat: 19.9049, lng: 99.8349, start: "2026-11-30T18:30", end: "2026-11-30T21:00", outdoor: true },
    ],
    drives: [
      { id: "d30-pier", fromId: "lodging:cr", toId: "kok-boat", departAt: "2026-11-30T10:00" },
      { id: "d30-lunch", fromId: "pha-soet", toId: "kok-river-lunch", departAt: "2026-11-30T13:15" },
      { id: "d30-blue", fromId: "lodging:cr", toId: "blue-temple", departAt: "2026-11-30T16:45" },
    ],
    reminders: [],
    planB: [
      "גשם חזק או נהר גבוה: לוותר על השייט ולנסוע בוואן לכפר Ruammit ולמעיינות Pha Soet בכביש שלאורך הנהר.",
      "גשם בערב: המקדש הכחול מקורה ברובו. בשוק הלילה לשבת ברחבת האוכל המקורה.",
    ],
  },
  {
    date: "2026-12-01",
    titleHe: "סדנת בישול Akha Kitchen",
    lodgingId: "cr",
    stops: [
      { id: "akha-kitchen", nameHe: "סדנת בישול Akha Kitchen", nameEn: "Akha Kitchen", lat: 19.91, lng: 99.84, start: "2026-12-01T09:00", end: "2026-12-01T14:00", outdoor: false, noteHe: "מתחילים בסיור בשוק מקומי עם השפית ג'ארוואן. מיקום משוער, לעדכן לפי נקודת המפגש. אחרי הסדנה: אפשרות למרכז שבטי ההרים (Hilltribe Museum) או לבית הקפה Lalitta Café." },
    ],
    drives: [],
    reminders: [],
    planB: ["הסדנה בוטלה: שוק הבוקר של צ'יאנג ראי ומוזיאון שבטי ההרים (Hilltribe Museum)."],
  },
  {
    date: "2026-12-02",
    titleHe: "חזרה לצ'אנג מאי וקניות אחרונות",
    lodgingId: "cm2",
    stops: [
      { id: "cm-night-bazaar", nameHe: "בזאר צ'אנג מאי, מסאז' וארוחת סיום", nameEn: "Chiang Mai Night Bazaar", lat: 18.7854, lng: 99.0007, start: "2026-12-02T13:00", end: "2026-12-02T21:00", outdoor: true, noteHe: "לארוחת הסיום: Paak Dang Riverside Restaurant (טלפון ‎+66 94 994 9353) או Samsen Villa." },
    ],
    drives: [{ id: "d02-chiangmai", fromId: "lodging:cr", toId: "lodging:cm2", departAt: "2026-12-02T09:00" }],
    reminders: [{ id: "r02-checkout", at: "2026-12-02T21:00", textHe: "מחר צ'ק-אאוט ב-05:30. לארוז הערב ולכוון שעון מעורר." }],
    planB: ["גשם: קניוני Maya ו-One Nimman, ומסאז' פרידה."],
  },
  {
    date: "2026-12-03",
    titleHe: "טיסה הביתה",
    lodgingId: null,
    stops: [
      { id: "cnx-depart", nameHe: "שדה התעופה צ'אנג מאי", nameEn: "Chiang Mai Airport", lat: 18.7668, lng: 98.9626, start: "2026-12-03T05:45", end: "2026-12-03T07:30", outdoor: false },
    ],
    drives: [],
    reminders: [],
    planB: ["טיסה בוטלה או עוכבה: לפנות לדלפק Etihad ולחברת הביטוח, ולשמור קבלות על לינה ואוכל."],
  },
];

/**
 * The itinerary without hotels or flights. This is what the app bundle contains, so it is safe
 * to publish; the app fetches the private part from the worker with its access code.
 */
export const publicTrip: Trip = {
  name: "צפון תאילנד 2026",
  startDate: "2026-11-21",
  endDate: "2026-12-03",
  days,
  lodgings: [],
  flights: [],
};

export const withPrivate = (base: Trip, priv: TripPrivate | null | undefined): Trip =>
  priv ? { ...base, lodgings: priv.lodgings, flights: priv.flights } : base;
