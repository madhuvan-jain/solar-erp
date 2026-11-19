// Plus Codes (Open Location Code): a short, free address for any spot on Earth, e.g. "7MR56Q53+H69", or
// "6Q53+H69, Pirthipur" next to a nearby town. Written from the open specification
// (https://github.com/google/open-location-code/blob/main/Documentation/Specification/specification.md).
const ALPHABET = '23456789CFGHJMPQRVWX';
const LAT_MUL = 8000 * 3125; // pair precision × 5^5 grid rows
const LNG_MUL = 8000 * 1024; // pair precision × 4^5 grid columns

/** Full code; length 10 is about 14 m, 11 about 3 m (as GPS photo stamps use). */
export function plusCode(lat: number, lng: number, length = 11): string {
  const la = Math.min(Math.max(lat, -90), 90 - 1e-10);
  let ln = ((lng + 180) % 360 + 360) % 360 - 180;
  if (ln === 180) ln = -180;
  let latVal = Math.floor(Math.round((la + 90) * LAT_MUL * 1e6) / 1e6);
  let lngVal = Math.floor(Math.round((ln + 180) * LNG_MUL * 1e6) / 1e6);
  let code = '';
  for (let i = 0; i < 5; i++) {
    code = ALPHABET[(latVal % 5) * 4 + (lngVal % 4)] + code;
    latVal = Math.floor(latVal / 5);
    lngVal = Math.floor(lngVal / 4);
  }
  for (let i = 0; i < 5; i++) {
    code = ALPHABET[latVal % 20] + ALPHABET[lngVal % 20] + code;
    latVal = Math.floor(latVal / 20);
    lngVal = Math.floor(lngVal / 20);
  }
  const full = code.slice(0, 8) + '+' + code.slice(8);
  return full.slice(0, Math.max(10, length) + 1);
}

/** Drops the first four characters when a named place within ~30 km gives the area ("6Q53+H69"). */
export function shortPlusCode(code: string, lat: number, lng: number, refLat: number, refLng: number): string | null {
  return Math.max(Math.abs(lat - refLat), Math.abs(lng - refLng)) < 0.3 ? code.slice(4) : null;
}
