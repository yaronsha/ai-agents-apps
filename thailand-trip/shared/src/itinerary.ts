// Built from "צפון תאילנד 10.8.docx" (Google Drive, version of 2026-10-03).
// Coordinates are approximate (a few hundred metres to a couple of km); fix any that look off on the map.
import type { Day, Trip, TripPrivate } from "./types";

const days: Day[] = [
  {
    date: "2026-11-22",
    titleHe: "נחיתה, כפר האומנים ושקיעה בדוי סוטפ",
    lodgingId: "cm1",
    stops: [
      { id: "cnx-arrive", nameHe: "נחיתה בשדה התעופה צ'אנג מאי", nameEn: "Chiang Mai Airport", lat: 18.7668, lng: 98.9626, start: "2026-11-22T06:05", end: "2026-11-22T07:00", outdoor: false },
      { id: "baan-kang-wat", nameHe: "כפר האומנים באן קאנג וואט", nameEn: "Baan Kang Wat", lat: 18.7766, lng: 98.9452, start: "2026-11-22T15:00", end: "2026-11-22T16:45", outdoor: true },
      { id: "doi-suthep", nameHe: "מקדש דוי סוטפ בשקיעה", nameEn: "Wat Phra That Doi Suthep", lat: 18.805, lng: 98.9217, start: "2026-11-22T17:30", end: "2026-11-22T19:15", outdoor: true },
    ],
    drives: [{ id: "d22-suthep", fromId: "baan-kang-wat", toId: "doi-suthep", departAt: "2026-11-22T16:45" }],
    reminders: [{ id: "r22-suthep", at: "2026-11-22T16:15", textHe: "בעוד חצי שעה יוצאים לדוי סוטפ כדי להספיק את השקיעה." }],
    planB: [
      "גשם: לוותר על כפר האומנים ולעבור למוזיאון MAIIAM או לשוק Warorot המקורה.",
      "מעונן או גשום בשקיעה: לבקר בדוי סוטפ מחר בבוקר ולוותר על השקיעה.",
    ],
  },
  {
    date: "2026-11-23",
    titleHe: "דוי אינתנון: פגודות המלך והמלכה וטרק המפלים",
    lodgingId: "cm1",
    stops: [
      { id: "twin-pagodas", nameHe: "פגודות המלך והמלכה", nameEn: "Naphamethinidon & Naphaphonphumisiri", lat: 18.5446, lng: 98.5005, start: "2026-11-23T09:00", end: "2026-11-23T10:30", outdoor: true, highland: true, noteHe: "קר בבוקר, לפעמים פחות מ-15 מעלות." },
      { id: "pha-dok-siew", nameHe: "טרק Pha Dok Siew עם מדריך קארן", nameEn: "Pha Dok Siew Trail", lat: 18.5336, lng: 98.5245, start: "2026-11-23T11:00", end: "2026-11-23T13:00", outdoor: true, highland: true },
      { id: "mae-klang-luang", nameHe: "צהריים בכפר Mae Klang Luang", nameEn: "Mae Klang Luang village", lat: 18.5275, lng: 98.5337, start: "2026-11-23T13:00", end: "2026-11-23T14:30", outdoor: false },
      { id: "old-city-night", nameHe: "סיור לילי בעיר העתיקה", nameEn: "Old City temples by night", lat: 18.7869, lng: 98.9866, start: "2026-11-23T19:30", end: "2026-11-23T21:30", outdoor: true },
    ],
    drives: [
      { id: "d23-inthanon", fromId: "lodging:cm1", toId: "twin-pagodas", departAt: "2026-11-23T07:00" },
      { id: "d23-back", fromId: "mae-klang-luang", toId: "lodging:cm1", departAt: "2026-11-23T14:30" },
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
      { id: "lantern-festival", nameHe: "פסטיבל הפנסים CAD Khomloy", nameEn: "CAD Khomloy Sky Lantern Festival", lat: 18.873, lng: 99.139, start: "2026-11-24T17:00", end: "2026-11-24T21:30", outdoor: true, noteHe: "מיקום משוער, לעדכן לפי הכרטיס. נקודת האיסוף ב-15:30." },
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
    titleHe: "דרך ההרים לפאי, מעיינות חמים ולוי קראטונג",
    lodgingId: "pai",
    stops: [
      { id: "pai-memorial-bridge", nameHe: "גשר הזיכרון של פאי", nameEn: "Pai Memorial Bridge", lat: 19.297, lng: 98.456, start: "2026-11-25T11:45", end: "2026-11-25T12:15", outdoor: true },
      { id: "tha-pai-hot-springs", nameHe: "המעיינות החמים טא פאי", nameEn: "Tha Pai Hot Springs", lat: 19.3053, lng: 98.4744, start: "2026-11-25T12:30", end: "2026-11-25T14:30", outdoor: true },
      { id: "pai-loy-krathong", nameHe: "לוי קראטונג על נהר פאי", nameEn: "Loy Krathong, Pai river", lat: 19.3596, lng: 98.4455, start: "2026-11-25T17:00", end: "2026-11-25T21:00", outdoor: true, noteHe: "הלילה המרכזי הוא 24.11; ב-25.11 החגיגות כנראה קטנות יותר." },
    ],
    drives: [{ id: "d25-pai", fromId: "lodging:cm1", toId: "pai-memorial-bridge", departAt: "2026-11-25T08:30" }],
    reminders: [{ id: "r25-van", at: "2026-11-25T08:00", textHe: "הנהג מגיע ב-08:30. כביש 1095 מפותל מאוד, כדאי כדור נגד בחילה." }],
    planB: [
      "כביש 1095 חסום או מוצף: לעכב את היציאה ולהתייעץ עם הנהג על מצב הכביש.",
      "גשם בערב: לחגוג בשוק הלילה (Walking Street) ולשוט קראטונג כשהגשם נחלש.",
    ],
  },
  {
    date: "2026-11-26",
    titleHe: "מערת תאם לוד ושקיעה בקניון פאי",
    lodgingId: "pai",
    stops: [
      { id: "doi-kiew-lom", nameHe: "תצפית דוי קיו לו", nameEn: "Doi Kiew Lom Viewpoint", lat: 19.4228, lng: 98.3265, start: "2026-11-26T10:30", end: "2026-11-26T10:50", outdoor: true },
      { id: "tham-lod", nameHe: "מערת תאם לוד", nameEn: "Tham Lod Cave", lat: 19.5664, lng: 98.2789, start: "2026-11-26T11:30", end: "2026-11-26T14:00", outdoor: false },
      { id: "yun-lai", nameHe: "תצפית Yun Lai", nameEn: "Yun Lai Viewpoint", lat: 19.3518, lng: 98.4196, start: "2026-11-26T15:00", end: "2026-11-26T15:30", outdoor: true },
      { id: "pai-canyon", nameHe: "שקיעה בקניון פאי", nameEn: "Pai Canyon", lat: 19.3076, lng: 98.4558, start: "2026-11-26T16:30", end: "2026-11-26T18:15", outdoor: true },
      { id: "pai-walking-street", nameHe: "שוק הלילה של פאי", nameEn: "Pai Walking Street", lat: 19.3589, lng: 98.4406, start: "2026-11-26T20:00", end: "2026-11-26T22:00", outdoor: true },
    ],
    drives: [
      { id: "d26-thamlod", fromId: "lodging:pai", toId: "doi-kiew-lom", departAt: "2026-11-26T09:30" },
      { id: "d26-back", fromId: "tham-lod", toId: "yun-lai", departAt: "2026-11-26T14:00" },
    ],
    reminders: [],
    planB: [
      "גשם בשקיעה: לצפות מתצפית Yun Lai או מבית קפה מקורה. שבילי החימר בקניון חלקלקים ומסוכנים ברטיבות.",
      "שייט הרפסודות במערה מושבת בגלל מים גבוהים: סיור רגלי בלבד, או כפר באן ג'אבו והמרק התלוי.",
    ],
  },
  {
    date: "2026-11-27",
    titleHe: "גשר הבמבוק, מפלים ומעבר לצ'אנג דאו",
    lodgingId: "cd",
    stops: [
      { id: "boon-ko-ku-so", nameHe: "גשר הבמבוק בון קו קו סו", nameEn: "Boon Ko Ku So Bamboo Bridge", lat: 19.3172, lng: 98.3953, start: "2026-11-27T09:20", end: "2026-11-27T10:15", outdoor: true },
      { id: "pam-bok", nameHe: "מפל פאם בוק", nameEn: "Pam Bok Waterfall", lat: 19.3564, lng: 98.3688, start: "2026-11-27T10:30", end: "2026-11-27T11:00", outdoor: true },
      { id: "doi-kiew-lom-27", nameHe: "תצפית דוי קיו לו (שוב)", nameEn: "Doi Kiew Lom Viewpoint", lat: 19.4228, lng: 98.3265, start: "2026-11-27T13:00", end: "2026-11-27T13:20", outdoor: true, noteHe: "מופיעה כך בקובץ, אבל היא לא על הדרך לצ'אנג דאו. כדאי לבדוק." },
      { id: "mok-fa", nameHe: "מפל מוק פה", nameEn: "Mok Fa Waterfall", lat: 19.1088, lng: 98.7718, start: "2026-11-27T14:15", end: "2026-11-27T15:00", outdoor: true },
    ],
    drives: [
      { id: "d27-mokfa", fromId: "pam-bok", toId: "mok-fa", departAt: "2026-11-27T11:00" },
      { id: "d27-chiangdao", fromId: "mok-fa", toId: "lodging:cd", departAt: "2026-11-27T15:00" },
    ],
    reminders: [],
    planB: [
      "גשם: לוותר על מפל פאם בוק (קניון צר, סכנת שיטפון פתאומי) ולצאת מוקדם יותר לצ'אנג דאו.",
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
    titleHe: "מפל קון קורן, המקדש הלבן והכחול",
    lodgingId: "cr",
    stops: [
      { id: "khun-korn", nameHe: "טרק מפל קון קורן", nameEn: "Khun Korn Waterfall", lat: 19.8628, lng: 99.6433, start: "2026-11-29T09:30", end: "2026-11-29T12:30", outdoor: true },
      { id: "white-temple", nameHe: "המקדש הלבן", nameEn: "Wat Rong Khun", lat: 19.8243, lng: 99.7633, start: "2026-11-29T15:50", end: "2026-11-29T16:50", outdoor: true },
      { id: "blue-temple", nameHe: "המקדש הכחול", nameEn: "Wat Rong Suea Ten", lat: 19.9218, lng: 99.8421, start: "2026-11-29T17:10", end: "2026-11-29T17:55", outdoor: true },
      { id: "cr-walking-street", nameHe: "שוק יום ראשון בצ'יאנג ראי", nameEn: "Chiang Rai Walking Street", lat: 19.9071, lng: 99.8302, start: "2026-11-29T19:30", end: "2026-11-29T22:00", outdoor: true },
    ],
    drives: [
      { id: "d29-khunkorn", fromId: "lodging:dc", toId: "khun-korn", departAt: "2026-11-29T08:30" },
      { id: "d29-chiangrai", fromId: "khun-korn", toId: "lodging:cr", departAt: "2026-11-29T12:30" },
    ],
    reminders: [{ id: "r29-phuchifa", at: "2026-11-29T21:00", textHe: "מחר השכמה ב-03:30 לפו צ'י פה. להכין פנס ובגד חם." }],
    planB: ["גשם בטרק קון קורן: השביל חלקלק, להסתפק בחלק הראשון או לדלג ולהגיע מוקדם לצ'יאנג ראי."],
  },
  {
    date: "2026-11-30",
    titleHe: "זריחה מעל ים העננים בפו צ'י פה",
    lodgingId: "cr",
    stops: [
      { id: "phu-chi-fa", nameHe: "זריחה בצוק פו צ'י פה", nameEn: "Phu Chi Fa", lat: 19.8556, lng: 100.4458, start: "2026-11-30T06:00", end: "2026-11-30T08:30", outdoor: true, highland: true },
      { id: "kok-river-lunch", nameHe: "צהריים על נהר הקוק", nameEn: "Kok River lunch", lat: 19.9175, lng: 99.8295, start: "2026-11-30T15:00", end: "2026-11-30T16:30", outdoor: false },
      { id: "cr-night-bazaar", nameHe: "שוק הלילה של צ'יאנג ראי", nameEn: "Chiang Rai Night Bazaar", lat: 19.9049, lng: 99.8349, start: "2026-11-30T18:30", end: "2026-11-30T21:00", outdoor: true },
    ],
    drives: [{ id: "d30-phuchifa", fromId: "lodging:cr", toId: "phu-chi-fa", departAt: "2026-11-30T03:30" }],
    reminders: [],
    planB: [
      "סיכוי נמוך לים עננים או גשם: לדלג על ההשכמה ולישון. אפשר לבקר במקדש Wat Huay Pla Kang במקום.",
    ],
  },
  {
    date: "2026-12-01",
    titleHe: "סדנת בישול Akha Kitchen",
    lodgingId: "cr",
    stops: [
      { id: "akha-kitchen", nameHe: "סדנת בישול Akha Kitchen", nameEn: "Akha Kitchen", lat: 19.91, lng: 99.84, start: "2026-12-01T09:00", end: "2026-12-01T14:00", outdoor: false, noteHe: "מיקום משוער, לעדכן לפי נקודת המפגש." },
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
      { id: "cm-night-bazaar", nameHe: "בזאר צ'אנג מאי, מסאז' וארוחת סיום", nameEn: "Chiang Mai Night Bazaar", lat: 18.7854, lng: 99.0007, start: "2026-12-02T13:00", end: "2026-12-02T21:00", outdoor: true },
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
