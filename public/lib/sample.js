// Zwei erfundene Beispiel-Exporte. Keine echten Firmen, Personen oder Zahlen.
//
// 1. Ein Deal-Export mit Phasenhistorie im Stil von HubSpot („Date entered …“),
//    400 Deals, fester Zufalls-Startwert. Absichtlich eingebaute Lecks:
//    wenige Deals kommen von Demo zu Proposal, Webinar-Leads schließen
//    schlechter ab, „Rep C“ lässt Angebote liegen, ein paar Beträge fehlen.
// 2. Ein kleiner deutscher Export ohne Historie: andere Spaltennamen,
//    Semikolon, deutsches Datum, fehlende und kaputte Werte.

import { dayToIso, parseDate } from "./values.js";

export const SEED = 20261113;
export const STAGES = ["Lead", "Qualified", "Demo", "Proposal", "Negotiation", "Closed Won", "Closed Lost"];
const SOURCES = ["Website", "Referral", "Webinar", "Outbound"];
const OWNERS = ["Rep A", "Rep B", "Rep C", "Rep D"];
// Chance, aus Phase i in die nächste zu kommen. Demo -> Proposal ist das Leck.
const ADVANCE = [0.75, 0.7, 0.38, 0.65, 0.62];
const STAY = [[2, 8], [4, 14], [5, 18], [10, 35], [7, 25]];

/**
 * mulberry32: kleiner, fester Zufallsgenerator. Gleicher Startwert, gleiche Daten.
 * @param {number} seed
 * @returns {() => number}
 */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {unknown} v */
const q = (v) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/**
 * @param {number} [count]
 * @param {number} [seed]
 * @returns {string}
 */
export function exampleWithHistory(count = 400, seed = SEED) {
  const r = rng(seed);
  const pick = (/** @type {string[]} */ list) => list[Math.floor(r() * list.length)] ?? "";
  const between = (/** @type {number} */ lo, /** @type {number} */ hi) => lo + Math.floor(r() * (hi - lo + 1));
  const start = /** @type {number} */ (parseDate("2026-01-05"));
  const asOf = /** @type {number} */ (parseDate("2026-10-31"));
  const header = ["Deal ID", "Deal Name", "Deal Stage", "Amount", "Create Date", "Close Date", "Last Activity Date", "Original Source", "Deal Owner", ...STAGES.map((s) => `Date entered "${s} (Sales Pipeline)"`)];
  const lines = [header.map(q).join(",")];

  for (let n = 1; n <= count; n++) {
    const source = pick(SOURCES);
    const owner = pick(OWNERS);
    const created = between(start, asOf - 5);
    /** @type {(number | null)[]} */
    const entered = STAGES.map(() => null);
    entered[0] = created;
    let at = 0;
    let t = created;
    let stage = 0;
    let closed = null;
    while (at < 5) {
      const [lo = 5, hi = 10] = STAY[at] ?? [];
      const slow = owner === "Rep C" && at === 3 ? 2 : 1;
      const next = t + between(lo, hi) * slow;
      if (next > asOf) break; // noch in dieser Phase
      const p = (ADVANCE[at] ?? 0.5) * (source === "Webinar" && at >= 2 ? 0.55 : 1);
      if (r() < p) {
        at++;
        t = next;
        stage = at === 5 ? 5 : at;
        entered[stage] = t;
        if (at === 5) closed = t;
      } else {
        if (r() < 0.55) {
          stage = 6;
          entered[6] = next;
          closed = next;
        }
        break;
      }
    }
    // Letzte Aktivität: abgeschlossene kurz nach dem letzten Schritt, offene
    // meist in den letzten Wochen. Rep C lässt Angebote liegen, dazu ein paar
    // vergessene Deals quer durch.
    const lastStep = Math.max(...entered.filter((v) => v !== null).map(Number));
    let last = closed === null ? Math.max(lastStep, asOf - between(0, 25)) : Math.min(asOf, lastStep + between(0, 12));
    if (closed === null && owner === "Rep C" && stage === 3) last = Math.max(lastStep, asOf - between(35, 90));
    if (closed === null && r() < 0.08) last = Math.max(lastStep, asOf - between(31, 70));
    const amount = r() < 0.05 ? "" : String(between(4, 80) * 500);
    lines.push(
      [
        `D-${String(n).padStart(4, "0")}`,
        `Example deal ${String(n).padStart(3, "0")}`,
        STAGES[stage],
        amount,
        dayToIso(created),
        closed === null ? "" : dayToIso(closed),
        dayToIso(last),
        source,
        closed === null && r() < 0.04 ? "" : owner,
        ...entered.map((v) => (v === null ? "" : dayToIso(v))),
      ]
        .map(q)
        .join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// Klein genug, um jede Zahl von Hand nachzurechnen (siehe test/audit.test.ts).
export const GERMAN_EXPORT = `Name;Phase;Betrag;Erstellt am;Letzte Aktivität;Quelle;Verantwortlich
Beispiel 01;Erstkontakt;5.000,00 €;02.06.2026;28.10.2026;Messe;Kim
Beispiel 02;Erstkontakt;;15.09.2026;20.10.2026;Website;Kim
Beispiel 03;Angebot;12.500,00 €;10.03.2026;01.08.2026;Empfehlung;Noah
Beispiel 04;Angebot;8.000 €;01.07.2026;30.10.2026;Website;
Beispiel 05;Angebot;20.000,00 €;31.02.2026;15.09.2026;Messe;Noah
Beispiel 06;Verhandlung;30.000,00 €;05.01.2026;25.08.2026;Empfehlung;Kim
Beispiel 07;Verhandlung;k. A.;12.05.2026;;Website;Noah
Beispiel 08;Gewonnen;15.000,00 €;10.01.2026;20.04.2026;Messe;Kim
Beispiel 09;Gewonnen;9.500,00 €;03.02.2026;11.05.2026;Website;Noah
Beispiel 10;Verloren;4.000,00 €;20.02.2026;01.04.2026;Messe;Kim
Beispiel 11;Verloren;6.000,00 €;14.04.2026;30.06.2026;Website;Noah
Beispiel 12;Gewonnen;11.000,00 €;01.03.2026;31.10.2026;Empfehlung;Kim
`;
