import { describe, expect, it } from "vitest";
import { audit } from "../public/lib/audit.js";
import { defaultOrder, detectColumns, historyColumns, stageKind } from "../public/lib/columns.js";
import { parseCsv } from "../public/lib/csv.js";
import { exampleWithHistory, GERMAN_EXPORT, STAGES } from "../public/lib/sample.js";
import { median, parseAmount, parseDate } from "../public/lib/values.js";

function run(csv: string, options = {}) {
  const table = parseCsv(csv);
  const map = detectColumns(table.header);
  const history = historyColumns(table.header);
  const order = defaultOrder(table.rows.map((r) => (map.stage >= 0 ? r[map.stage] ?? "" : "")), history);
  return { table, map, history, order, result: audit(table, map, history, order, options) };
}

describe("reading values", () => {
  it("reads dates in ISO, German and US form, and refuses impossible ones", () => {
    expect(parseDate("2026-03-14")).toBe(parseDate("14.03.2026"));
    expect(parseDate("14.3.26")).toBe(parseDate("2026-03-14"));
    expect(parseDate("03/14/2026")).toBe(parseDate("2026-03-14"));
    expect(parseDate("2026-03-14T09:30:00Z")).toBe(parseDate("2026-03-14"));
    expect(parseDate("31.02.2026")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseDate("soon")).toBeNull();
  });

  it("reads amounts with either thousands separator", () => {
    expect(parseAmount("12.500,00 €")).toBe(12500);
    expect(parseAmount("12,500.00")).toBe(12500);
    expect(parseAmount("$1,200")).toBe(1200);
    expect(parseAmount("8.000 €")).toBe(8000);
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("k. A.")).toBeNull();
    expect(parseAmount("")).toBeNull();
  });

  it("takes the median of an even list as the mean of the middle two", () => {
    expect(median([10, 15, 10])).toBe(10);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });

  it("reads quoted fields and semicolons", () => {
    const t = parseCsv('a;b\r\n"x;y";"say ""hi"""\r\n\r\n');
    expect(t.delimiter).toBe(";");
    expect(t.rows).toEqual([["x;y", 'say "hi"']]);
  });
});

describe("finding the columns", () => {
  it("maps German column names", () => {
    const { map, table } = run(GERMAN_EXPORT);
    expect(table.header[map.stage]).toBe("Phase");
    expect(table.header[map.amount]).toBe("Betrag");
    expect(table.header[map.created]).toBe("Erstellt am");
    expect(table.header[map.lastActivity]).toBe("Letzte Aktivität");
    expect(table.header[map.source]).toBe("Quelle");
    expect(table.header[map.owner]).toBe("Verantwortlich");
    expect(map.closed).toBe(-1);
  });

  it("reads HubSpot-style stage history columns", () => {
    expect(historyColumns(['Date entered "Demo (Sales Pipeline)"', "Amount", "Entered Proposal"])).toEqual([
      { index: 0, stage: "Demo" },
      { index: 2, stage: "Proposal" },
    ]);
  });

  it("puts won and lost at the end of the stage order", () => {
    expect(defaultOrder(["Verloren", "Angebot", "Gewonnen", "Erstkontakt"], [])).toEqual(["Angebot", "Erstkontakt", "Gewonnen", "Verloren"]);
    expect(stageKind("Closed Won")).toBe("won");
    expect(stageKind("Verloren")).toBe("lost");
  });
});

// Zwölf Zeilen, Stichtag ist das späteste Datum: 31.10.2026 (Beispiel 12).
describe("German export without history", () => {
  const { result, order } = run(GERMAN_EXPORT);
  if (!result.ok) throw new Error(result.error);

  it("uses the latest date in the file as the reference date", () => {
    expect(result.asOf).toBe("2026-10-31");
    expect(order).toEqual(["Erstkontakt", "Angebot", "Verhandlung", "Gewonnen", "Verloren"]);
  });

  it("counts open deals and amounts per stage, skipping unreadable amounts", () => {
    // Angebot: 12.500 + 8.000 + 20.000. Verhandlung: 30.000, „k. A.“ zählt nicht.
    expect(result.snapshot.stages.map((s) => [s.stage, s.count, s.amount, s.missingAmount])).toEqual([
      ["Erstkontakt", 2, 5000, 1],
      ["Angebot", 3, 40500, 0],
      ["Verhandlung", 2, 30000, 1],
      ["Gewonnen", 3, 35500, 0],
      ["Verloren", 2, 10000, 0],
    ]);
    expect(result.snapshot.openCount).toBe(7);
    expect(result.snapshot.openAmount).toBe(75500);
  });

  it("lists data gaps with their rows", () => {
    const g = Object.fromEntries(result.gaps.map((x) => [x.label, [x.count, x.of, x.rows]]));
    expect(g["Deals without an amount"]).toEqual([1, 12, [3]]);
    expect(g["Amounts that could not be read"]).toEqual([1, 12, [8]]);
    expect(g["Created dates that could not be read"]).toEqual([1, 12, [6]]); // 31.02.2026
    expect(g["Open deals without an owner"]).toEqual([1, 7, [5]]);
    expect(g["Open deals without a last activity date"]).toEqual([1, 7, [8]]);
  });

  it("measures age of open deals from the created date", () => {
    // Sechs offene Deals mit lesbarem Datum. Vor dem 02.08.2026 erstellt: 01, 03, 04, 06, 07.
    expect(result.age).toMatchObject({ open: 7, dated: 6, undated: 1, old: 5, oldAmount: 55500 });
  });

  it("finds stalled deals from the last activity date", () => {
    // Mehr als 30 Tage still: 03 (01.08.), 05 (15.09.), 06 (25.08.). 07 hat kein Datum.
    expect(result.stalled).toMatchObject({ computable: true, count: 3, of: 6, unknown: 1, amount: 62500 });
  });

  it("marks stage conversion and time in stage as not computable and names the missing columns", () => {
    expect(result.flow.computable).toBe(false);
    if (result.flow.computable) return;
    expect(result.flow.needs).toEqual(["Date entered Erstkontakt", "Date entered Angebot", "Date entered Verhandlung"]);
  });

  it("only shows win rates for groups with enough closed deals", () => {
    expect(result.bySource?.overall).toEqual({ won: 3, closed: 5, rate: 0.6 });
    expect(result.bySource?.groups).toEqual([]);
    expect(result.bySource?.small).toBe(3);
    const loose = run(GERMAN_EXPORT, { minGroup: 1 }).result;
    if (!loose.ok) throw new Error(loose.error);
    expect(loose.bySource?.groups.map((g) => [g.name, g.won, g.closed])).toEqual([
      ["Messe", 1, 2],
      ["Website", 1, 2],
      ["Empfehlung", 1, 1],
    ]);
  });

  it("ranks the three biggest leaks by the share of deals affected", () => {
    // Alt: 5/6. Still: 3/6. Ohne Verantwortlichen 1/7 (vor „ohne Aktivität“ 1/7, gleiche Quote).
    expect(result.fixFirst.map((f) => [f.title, Math.round(f.share * 1000) / 1000])).toEqual([
      ["5 open deals are older than 90 days", 0.833],
      ["3 open deals have gone quiet", 0.5],
      ["Open deals without an owner", 0.143],
    ]);
    expect(result.fixFirst[1]?.calc).toContain("Share: 3 / 6 = 50%");
  });
});

// Kleiner Datensatz mit Historie. Stichtag 30.06.2026, Reife 60 Tage: Kohorte bis 01.05.2026.
const HISTORY = `Deal;Stage;Date entered A;Date entered B;Date entered C;Date entered Won;Date entered Lost
1;Won;2026-01-01;2026-01-11;2026-02-01;2026-03-01;
2;B;2026-01-05;2026-01-20;;;
3;Lost;2026-01-10;;;;2026-02-01
4;Lost;2026-02-01;2026-02-11;;;2026-03-01
5;A;2026-06-01;;;;
6;C;2026-03-01;;;;
`;

describe("stage history", () => {
  const { result, order } = run(HISTORY, { asOf: parseDate("2026-06-30") as number });
  if (!result.ok) throw new Error(result.error);
  const flow = result.flow;
  if (!flow.computable) throw new Error("flow should be computable");
  const step = (s: string) => flow.steps.find((x) => x.stage === s);

  it("orders stages from the history columns", () => {
    expect(order).toEqual(["A", "B", "C", "Won", "Lost"]);
  });

  it("computes conversion from a mature cohort with numerator, denominator and period", () => {
    // A: Deals 1, 2, 3, 4, 6 (5 ist zu jung). Weiter: 1, 2, 4 (B) und 6 (steht in C). 3 ging verloren.
    expect(step("A")).toMatchObject({ cohort: 5, moved: 4, rate: 0.8, from: "2026-01-01", to: "2026-05-01", tooYoung: 1 });
    // B: 1, 2, 4. Nur 1 kam weiter. 4 ging verloren, das zählt nicht als weiter.
    expect(step("B")).toMatchObject({ cohort: 3, moved: 1, next: "C" });
    expect(step("C")).toMatchObject({ cohort: 1, moved: 1, next: "Won" });
  });

  it("measures time in stage only for deals that left it", () => {
    // A: 1 -> 10 Tage, 2 -> 15, 4 -> 10. Deal 6 hat kein Datum für den nächsten Schritt.
    expect(step("A")).toMatchObject({ medianDays: 10, timed: 3 });
    expect(step("B")).toMatchObject({ medianDays: 21, timed: 1, stillHere: 1 });
    expect(step("C")).toMatchObject({ medianDays: 28 });
  });

  it("says stalled deals need a last activity column", () => {
    expect(result.stalled).toMatchObject({ computable: false, needs: ["Last activity date"] });
  });
});

describe("example with history", () => {
  const csv = exampleWithHistory();
  const { result, history } = run(csv);
  if (!result.ok) throw new Error(result.error);

  it("is the same every time (fixed seed) and has 400 deals", () => {
    expect(exampleWithHistory()).toBe(csv);
    expect(result.deals).toBe(400);
    expect(history.map((h) => h.stage)).toEqual(STAGES);
  });

  it("shows the leak that was built in: Demo is the weakest step", () => {
    const flow = result.flow;
    if (!flow.computable) throw new Error("flow should be computable");
    const worst = [...flow.steps].filter((s) => s.cohort >= 10).sort((a, b) => (a.rate ?? 1) - (b.rate ?? 1))[0];
    expect(worst?.stage).toBe("Demo");
    expect(result.fixFirst.some((f) => f.title === "Deals stall after Demo")).toBe(true);
  });
});
