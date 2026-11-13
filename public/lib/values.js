// Werte aus CRM-Exporten lesen. Exporte kommen aus vielen Ländern: Datumsformate
// und Tausender-Trenner unterscheiden sich. Alles, was sich nicht sicher lesen
// lässt, wird null und später als Datenlücke gezählt, nicht geraten.

const DAY = 86_400_000;

/**
 * @param {number} y
 * @param {number} m
 * @param {number} d
 * @returns {number | null}
 */
function toDay(y, m, d) {
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  // 31.02. würde Date still auf den 3. März schieben. Das ist ein Fehler im Export.
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return Math.floor(t / DAY);
}

/**
 * Datum als ganze Tageszahl (Tage seit 1970-01-01, UTC), oder null.
 * Liest 2026-03-14 (auch mit Uhrzeit), 14.03.2026, 14.3.26 und 03/14/2026
 * (Schrägstrich: Monat zuerst, wie US-Exporte).
 * @param {string | undefined} raw
 * @returns {number | null}
 */
export function parseDate(raw) {
  const s = (raw ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/);
  if (m) return toDay(Number(m[1]), Number(m[2]), Number(m[3]));
  m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})(?:,?\s.*)?$/);
  if (m) {
    const y = m[3] ?? "";
    return toDay(y.length === 2 ? 2000 + Number(y) : Number(y), Number(m[2]), Number(m[1]));
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s.*)?$/);
  if (m) return toDay(Number(m[3]), Number(m[1]), Number(m[2]));
  return null;
}

/**
 * @param {number} day
 * @returns {string}
 */
export function dayToIso(day) {
  return new Date(day * DAY).toISOString().slice(0, 10);
}

/**
 * Betrag als Zahl, oder null. Liest 12500, 12,500.00, 12.500,00 €, $1,200.
 * Ein einzelner Trenner vor genau drei Ziffern gilt als Tausender-Trenner.
 * @param {string | undefined} raw
 * @returns {number | null}
 */
export function parseAmount(raw) {
  let s = (raw ?? "").replace(/[^\d.,-]/g, "");
  if (!/\d/.test(s)) return null;
  const comma = s.lastIndexOf(",");
  const dot = s.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    s = s.split(thousands).join("").replace(decimal, ".");
  } else if (comma >= 0) {
    s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (dot >= 0) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {string | undefined} raw
 * @returns {boolean}
 */
export function isBlank(raw) {
  const s = (raw ?? "").trim();
  return s === "" || s === "-" || s === "—" || /^(n\/a|null|none)$/i.test(s);
}

/**
 * Median, oder null bei leerer Liste.
 * @param {number[]} values
 * @returns {number | null}
 */
export function median(values) {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  const hi = v[mid] ?? 0;
  return v.length % 2 ? hi : ((v[mid - 1] ?? 0) + hi) / 2;
}
