// Restaurants Yaron ate at in Chiang Mai and recommends, each placed on the plan day and time it fits
// (open, and within walking distance of a stop). They are suggestions shown beside the plan, not
// stops: nothing in the plan moves for them. The one exception is Khao Soi Khun Yai, which took the
// place of the plan's generic khao soi lunch on 24.11 (stop "khao-soi"; its facts live in PLACE_FACTS).
// Facts gathered on 2026-11-20 from food guides, Tripadvisor, Wanderlog and Yaron's Google Maps
// screenshot, not from the places themselves. No dish recommendations (Yaron's call, 2026-11-20). Guides disagree on hours; the text says so. The worker's
// place check also looks up the picks that are not stops, on their day (worker/src/places.ts).
import type { LatLng } from "./types";
import type { PlaceFacts } from "./place-facts";

export interface Pick extends LatLng {
  id: string;
  nameHe: string;
  nameEn: string;
  /** Name in Thai script, to show a driver. */
  nameTh?: string;
  /** Plan day it is suggested for. */
  date: string;
  /** Suggested time, local ("YYYY-MM-DDTHH:mm"). Sorts into the day's timeline. */
  at: string;
  /** The plan stop this pick is (then it is not a separate row; the stop gets the badge). */
  stopId?: string;
  /** One short line on the card. */
  teaserHe: string;
  /**
   * Yaron's own words about the place, shown as his quote. Only what he wrote himself; never filled in
   * for him. Left out until he gives it.
   */
  yaronHe?: string;
  /** A practical tip from another source, which the text names ("לפי ביקורות בגוגל מפות..."). */
  tipHe?: string;
  /** Distance from the nearby stop. */
  walkHe: string;
  /** A known limit, shown in red on the card ("פתוח עד 14:00"). */
  warnHe?: string;
  /** The pin is placed from the address, not checked on a map yet. */
  approx: boolean;
  facts: PlaceFacts;
}

const CHECKED = "2026-11-20";

export const PICKS: Pick[] = [
  {
    id: "pick-sanmai",
    nameHe: "סאנמאי ראמן",
    nameEn: "Sanmai Ramen Nimman",
    date: "2026-12-01",
    at: "2026-12-01T18:30",
    teaserHe: "מסעדת ראמן יפנית",
    walkHe: "בנימן סוי 11, כמה דקות הליכה מקניון MAYA, כ-10 דקות נסיעה מהעיר העתיקה",
    warnHe: "לפי אחד המדריכים סגור בימי שני, לכן הוא מוצע לערב החזרה לצ'אנג מאי, יום שלישי 01.12. אפשרות נוספת לערב הזה: באמי ג'ה הואה.",
    lat: 18.7975,
    lng: 98.968,
    approx: true,
    facts: {
      hoursHe: "11:30-14:00 ו-17:00-20:30 (מדריך אחר כותב 11:30-21:30 ברצף)",
      closedOn: [1],
      closedNoteHe: "לפי אחד המדריכים סגור בימי ב'. לא ודאי.",
      feeHe: "כ-185-195 באט לקערה",
      payHe: "לפי מדריך מ-2026 לא מקבלים כרטיס. כדאי מזומן.",
      checked: CHECKED,
    },
  },
  {
    id: "pick-bami-jae-hua",
    nameHe: "באמי ג'ה הואה: נודלס סיניים",
    nameEn: "Bami Jae Hua Chinese noodle",
    nameTh: "บะหมี่เจ๊หัว สาขาเชียงใหม่",
    date: "2026-12-01",
    at: "2026-12-01T18:00",
    teaserHe: "מסעדת נודלס סינית",
    walkHe: "ברחוב צ'אנג קלאן, ליד הבזאר, כ-10 דקות נסיעה מהעיר העתיקה",
    warnHe: "פתוח עד 20:00. אפשרות נוספת לערב החזרה לצ'אנג מאי, לצד סאנמאי ראמן.",
    lat: 18.7745,
    lng: 99.0002,
    approx: true,
    facts: {
      hours: { open: "07:30", close: "20:00" },
      feeHe: "זול, עד כ-200 באט לאדם",
      payHe: "לפי ביקורות מזומן בלבד.",
      notesHe: ["כתובת: 199/10 Chang Khlan Rd, ליד מלון HOP INN צ'אנג קלאן."],
      checked: CHECKED,
    },
  },
  {
    id: "pick-soiseoul",
    nameHe: "סוי סיאול: על האש קוריאני",
    nameEn: "SoiSeoul ChangKlan",
    date: "2026-12-02",
    at: "2026-12-02T19:30",
    teaserHe: "על האש קוריאני, אפשרות נוספת לארוחת הסיום",
    tipHe: "מקום פשוט באוהל פתוח, בלי מזגן.",
    walkHe: "86/1 Chang Khlan Rd, ליד הבזאר",
    warnHe: "פתוח רק בערב.",
    lat: 18.78,
    lng: 99.0004,
    approx: true,
    facts: {
      hoursHe: "ערב בלבד, בערך 16:00 או 17:00 עד 22:00-23:15 (המקורות חלוקים)",
      notesHe: ["אוהל פתוח בלי מזגן, כדאי לבוש קליל."],
      checked: CHECKED,
    },
  },
  {
    id: "pick-khao-soi-khun-yai",
    nameHe: "קאו סוי קון יאי",
    nameEn: "Khao Soi Khun Yai",
    nameTh: "ข้าวซอยคุณยาย",
    date: "2026-11-24",
    at: "2026-11-24T12:00",
    stopId: "khao-soi",
    teaserHe: "הקאו סוי המפורסם של העיר העתיקה",
    tipHe: "לפי מדריכי אוכל, בצהריים יש לרוב תור.",
    walkHe: "כ-10 דקות הליכה מוואט צ'די לואנג, ליד החומה הצפונית",
    warnHe: "פתוח רק עד 14:00, ולפעמים נגמר מוקדם. כדאי להגיע עד 12:00.",
    lat: 18.7946,
    lng: 98.986,
    approx: true,
    facts: { checked: CHECKED },
  },
];

export const picksFor = (date: string): Pick[] => PICKS.filter((p) => p.date === date);
export const pickForStop = (stopId: string): Pick | undefined => PICKS.find((p) => p.stopId === stopId);
