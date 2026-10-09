// Checked on 2026-10-07: the Thai numbers against tourist guides, the Foreign Ministry situation room against
// Israeli embassy pages (embassies.gov.il). A number marked verify: true is not confirmed yet.
export interface EmergencyNumber {
  labelHe: string;
  phone: string;
  verify?: boolean;
}

export const emergencyNumbers: EmergencyNumber[] = [
  { labelHe: "משטרת תיירים (אנגלית)", phone: "1155" },
  { labelHe: "אמבולנס", phone: "1669" },
  { labelHe: "משטרה", phone: "191" },
  { labelHe: "כבאות", phone: "199" },
  { labelHe: "חמ\"ל משרד החוץ (ישראל)", phone: "+97225303155" },
];

export const embassyUrl = "https://embassies.gov.il/thailand/en/contacts";

export interface Hospital {
  name: string;
  area: string;
  lat: number;
  lng: number;
  /** Main or emergency line, local format. */
  phone?: string;
}

/**
 * Larger private and provincial hospitals near the route. Locations and phones checked on 2026-10-07.
 * Chiang Dao Hospital's location was checked on 2026-10-09 (Google Maps and OpenStreetMap agree within
 * 120 m); its phone is not set because no second source confirmed the one Google lists.
 */
export const hospitals: Hospital[] = [
  { name: "Chiang Mai Ram Hospital", area: "צ'אנג מאי", lat: 18.7963, lng: 98.9733, phone: "053-999-777" },
  { name: "Bangkok Hospital Chiang Mai", area: "צ'אנג מאי", lat: 18.7887, lng: 99.0263, phone: "052-089-888" },
  { name: "Pai Hospital", area: "פאי", lat: 19.3615, lng: 98.4374, phone: "053-699-211" },
  { name: "Chiang Dao Hospital", area: "צ'אנג דאו", lat: 19.4029, lng: 98.9752 },
  { name: "Overbrook Hospital", area: "צ'יאנג ראי", lat: 19.9123, lng: 99.8292, phone: "053-711-366" },
  { name: "Chiangrai Prachanukroh Hospital", area: "צ'יאנג ראי", lat: 19.901, lng: 99.8292, phone: "053-910-600" },
];

export interface Phrase {
  he: string;
  th: string;
}

/** To show the driver or a local. */
export const phrases: Phrase[] = [
  { he: "בבקשה קח אותנו לבית החולים", th: "กรุณาพาเราไปโรงพยาบาล" },
  { he: "בבקשה סע לאט יותר", th: "กรุณาขับช้าลงหน่อย" },
  { he: "אנחנו צריכים לעצור, בחילה", th: "ขอจอดหน่อย รู้สึกเมารถ" },
  { he: "הכביש פתוח?", th: "ถนนเปิดไหม" },
  { he: "בלי חריף בבקשה", th: "ไม่เผ็ดครับ/ค่ะ" },
];
