// Phone numbers marked verify: true came from memory, not from an official page. Check them before the trip.
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
  { labelHe: "חמ\"ל משרד החוץ (ישראל)", phone: "+97225303155", verify: true },
];

export const embassyUrl = "https://embassies.gov.il/thailand/en/contacts";

export interface Hospital {
  name: string;
  area: string;
  lat: number;
  lng: number;
}

/** Larger private and provincial hospitals near the route. Approximate coordinates. */
export const hospitals: Hospital[] = [
  { name: "Chiang Mai Ram Hospital", area: "צ'אנג מאי", lat: 18.7963, lng: 98.9733 },
  { name: "Bangkok Hospital Chiang Mai", area: "צ'אנג מאי", lat: 18.8105, lng: 99.0175 },
  { name: "Pai Hospital", area: "פאי", lat: 19.3614, lng: 98.4423 },
  { name: "Chiang Dao Hospital", area: "צ'אנג דאו", lat: 19.3655, lng: 98.9652 },
  { name: "Overbrook Hospital", area: "צ'יאנג ראי", lat: 19.9127, lng: 99.8355 },
  { name: "Chiangrai Prachanukroh Hospital", area: "צ'יאנג ראי", lat: 19.9037, lng: 99.8279 },
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
