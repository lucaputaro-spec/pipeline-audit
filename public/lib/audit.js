// Die Auswertung. Feste Regeln, keine AI. Jede Kennzahl trägt Zähler, Nenner
// und Zeitraum, damit man sie von Hand nachrechnen kann. Was die Daten nicht
// hergeben, wird als „nicht berechenbar“ markiert, mit den fehlenden Spalten.

import { stageKind } from "./columns.js";
import { dayToIso, isBlank, median, parseAmount, parseDate } from "./values.js";

/** @typedef {import("./columns.js").Mapping} Mapping */
/** @typedef {import("./columns.js").HistoryColumn} HistoryColumn */

/**
 * @typedef {{
 *   row: number, id: string, stage: string, stageIndex: number, kind: "open" | "won" | "lost" | "unknown",
 *   amount: number | null, amountRaw: string, created: number | null, createdRaw: string,
 *   last: number | null, lastRaw: string, source: string, owner: string, entered: Map<number, number>
 * }} Deal
 */

/**
 * @typedef {{ computable: false, needs: string[], why: string }} NotComputable
 * @typedef {{ title: string, sentence: string, share: number, calc: string[] }} Finding
 */

export const DEFAULTS = { stalledDays: 30, oldDays: 90, maturityDays: 60, minGroup: 5, minCohort: 10, minShare: 0.1 };

/**
 * @param {string[]} cells
 * @param {number} i
 * @returns {string}
 */
const cell = (cells, i) => (i >= 0 ? (cells[i] ?? "").trim() : "");

/**
 * @param {string[][]} rows
 * @param {Mapping} map
 * @param {HistoryColumn[]} history
 * @param {string[]} order
 * @returns {Deal[]}
 */
export function readDeals(rows, map, history, order) {
  const lower = order.map((s) => s.toLowerCase());
  return rows.map((cells, i) => {
    const stage = cell(cells, map.stage);
    const stageIndex = lower.indexOf(stage.toLowerCase());
    /** @type {Map<number, number>} */
    const entered = new Map();
    for (const h of history) {
      const at = lower.indexOf(h.stage.toLowerCase());
      const day = parseDate(cell(cells, h.index));
      if (at >= 0 && day !== null) entered.set(at, day);
    }
    const amountRaw = cell(cells, map.amount);
    const createdRaw = cell(cells, map.created);
    const lastRaw = cell(cells, map.lastActivity);
    return {
      row: i + 2, // Zeile in der Datei, mit Kopfzeile
      id: cell(cells, map.id) || `row ${i + 2}`,
      stage,
      stageIndex,
      kind: stage ? stageKind(stage) : "unknown",
      amount: parseAmount(amountRaw),
      amountRaw,
      created: parseDate(createdRaw),
      createdRaw,
      last: parseDate(lastRaw),
      lastRaw,
      source: cell(cells, map.source),
      owner: cell(cells, map.owner),
      entered,
    };
  });
}

/**
 * Stichtag: das späteste Datum im Export. So ändert sich das Ergebnis nicht
 * mit dem Tag, an dem man die Seite öffnet.
 * @param {Deal[]} deals
 * @returns {number | null}
 */
export function latestDay(deals) {
  let max = null;
  for (const d of deals) {
    for (const v of [d.created, d.last, ...d.entered.values()]) if (v !== null && (max === null || v > max)) max = v;
  }
  return max;
}

const pct = (/** @type {number} */ n, /** @type {number} */ d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "–");
const money = (/** @type {number} */ n) => Math.round(n).toLocaleString("en-US");
/** „1 open deal has“ statt „1 open deals have“. */
const deals_ = (/** @type {number} */ n, /** @type {string} */ what = "open deal") => `${n} ${what}${n === 1 ? "" : "s"}`;
const has = (/** @type {number} */ n) => (n === 1 ? "has" : "have");
const is = (/** @type {number} */ n) => (n === 1 ? "is" : "are");

/**
 * @param {Deal[]} deals
 * @param {Mapping} map
 */
function gaps(deals, map) {
  const open = deals.filter((d) => d.kind === "open");
  /** @type {{ label: string, count: number, of: number, rows: number[] }[]} */
  const out = [];
  /**
   * @param {string} label
   * @param {Deal[]} pool
   * @param {(d: Deal) => boolean} test
   */
  const add = (label, pool, test) => {
    const hit = pool.filter(test);
    out.push({ label, count: hit.length, of: pool.length, rows: hit.map((d) => d.row) });
  };
  if (map.stage >= 0) add("Deals without a stage", deals, (d) => !d.stage);
  if (map.amount >= 0) {
    add("Deals without an amount", deals, (d) => isBlank(d.amountRaw));
    add("Amounts that could not be read", deals, (d) => !isBlank(d.amountRaw) && d.amount === null);
  }
  if (map.created >= 0) {
    add("Deals without a created date", deals, (d) => isBlank(d.createdRaw));
    add("Created dates that could not be read", deals, (d) => !isBlank(d.createdRaw) && d.created === null);
  }
  if (map.owner >= 0) add("Open deals without an owner", open, (d) => !d.owner);
  if (map.source >= 0) add("Open deals without a source", open, (d) => !d.source);
  if (map.lastActivity >= 0) add("Open deals without a last activity date", open, (d) => d.last === null);
  return out;
}

/**
 * @param {Deal[]} deals
 * @param {string[]} order
 */
function snapshot(deals, order) {
  const stages = order.map((stage, i) => {
    const here = deals.filter((d) => d.stageIndex === i);
    const known = here.filter((d) => d.amount !== null);
    return {
      stage,
      kind: stageKind(stage),
      count: here.length,
      amount: known.reduce((s, d) => s + /** @type {number} */ (d.amount), 0),
      missingAmount: here.length - known.length,
    };
  });
  const unmatched = deals.filter((d) => d.stage && d.stageIndex < 0).length;
  const open = stages.filter((s) => s.kind === "open");
  return {
    stages,
    unmatched,
    openCount: open.reduce((s, x) => s + x.count, 0),
    openAmount: open.reduce((s, x) => s + x.amount, 0),
  };
}

/**
 * @param {Deal[]} deals
 * @param {string[]} order
 * @param {number} asOf
 * @param {number} oldDays
 */
function ages(deals, order, asOf, oldDays) {
  const open = deals.filter((d) => d.kind === "open" && d.stageIndex >= 0);
  const dated = open.filter((d) => d.created !== null);
  const age = (/** @type {Deal} */ d) => asOf - /** @type {number} */ (d.created);
  const old = dated.filter((d) => age(d) > oldDays);
  return {
    open: open.length,
    dated: dated.length,
    undated: open.length - dated.length,
    old: old.length,
    oldAmount: old.reduce((s, d) => s + (d.amount ?? 0), 0),
    oldDays,
    byStage: order
      .map((stage, i) => {
        const here = dated.filter((d) => d.stageIndex === i);
        return { stage, count: here.length, medianDays: median(here.map(age)) };
      })
      .filter((s) => stageKind(s.stage) === "open"),
  };
}

/**
 * @param {Deal[]} deals
 * @param {Mapping} map
 * @param {number} asOf
 * @param {number} days
 * @returns {NotComputable | { computable: true, days: number, count: number, of: number, unknown: number, amount: number, worst: Deal[] }}
 */
function stalled(deals, map, asOf, days) {
  if (map.lastActivity < 0) {
    return { computable: false, needs: ["Last activity date"], why: "A plain deal export shows where deals are, not whether anyone is working on them." };
  }
  const open = deals.filter((d) => d.kind === "open");
  const dated = open.filter((d) => d.last !== null);
  const hit = dated.filter((d) => asOf - /** @type {number} */ (d.last) > days);
  return {
    computable: true,
    days,
    count: hit.length,
    of: dated.length,
    unknown: open.length - dated.length,
    amount: hit.reduce((s, d) => s + (d.amount ?? 0), 0),
    worst: [...hit].sort((a, b) => /** @type {number} */ (a.last) - /** @type {number} */ (b.last)).slice(0, 8),
  };
}

/**
 * Hat der Deal eine Phase nach `i` erreicht? Belegt durch einen späteren
 * Eintrittszeitpunkt oder eine spätere aktuelle Phase. Verloren zählt nicht.
 * @param {Deal} d
 * @param {number} i
 * @param {string[]} order
 * @returns {number | null} Tag des nächsten erreichten Schritts, -1 wenn ohne Datum belegt, null wenn nicht
 */
function movedOn(d, i, order) {
  let first = null;
  for (const [at, day] of d.entered) {
    if (at > i && stageKind(order[at] ?? "") !== "lost" && (first === null || day < first)) first = day;
  }
  if (first !== null) return first;
  if (d.stageIndex > i && d.kind !== "lost") return -1;
  return null;
}

/**
 * Übergänge und Verweildauer. Nur mit Phasenhistorie.
 * Kohorte für Phase S: Deals, die S betreten haben, und zwar mindestens
 * `maturityDays` vor dem Stichtag. Jüngere hatten noch keine faire Chance
 * weiterzukommen und würden die Quote nach unten ziehen.
 * @param {Deal[]} deals
 * @param {string[]} order
 * @param {HistoryColumn[]} history
 * @param {number} asOf
 * @param {number} maturityDays
 */
function flow(deals, order, history, asOf, maturityDays) {
  const lower = order.map((s) => s.toLowerCase());
  const covered = new Set(history.map((h) => lower.indexOf(h.stage.toLowerCase())).filter((i) => i >= 0));
  const openStages = order.map((s, i) => ({ s, i })).filter((x) => stageKind(x.s) === "open");
  const missing = openStages.filter((x) => !covered.has(x.i)).map((x) => `Date entered ${x.s}`);
  if (covered.size < 2) {
    return /** @type {NotComputable} */ ({
      computable: false,
      needs: missing.length ? missing : ["Date entered <stage>, one column per stage"],
      why: "Conversion between stages and time in each stage need a timestamp for when each deal entered each stage. A plain export only shows the current stage.",
    });
  }
  const cutoff = asOf - maturityDays;
  const steps = openStages
    .filter((x) => covered.has(x.i))
    .map(({ s, i }) => {
      const entered = deals.filter((d) => d.entered.has(i));
      const cohort = entered.filter((d) => /** @type {number} */ (d.entered.get(i)) <= cutoff);
      const days = cohort.map((d) => /** @type {number} */ (d.entered.get(i)));
      const moved = cohort.filter((d) => movedOn(d, i, order) !== null);
      const durations = entered
        .map((d) => {
          const next = movedOn(d, i, order);
          return next !== null && next >= 0 ? next - /** @type {number} */ (d.entered.get(i)) : null;
        })
        .filter((v) => v !== null);
      const next = order.slice(i + 1).find((x) => stageKind(x) !== "lost") ?? "a later stage";
      return {
        stage: s,
        next,
        cohort: cohort.length,
        moved: moved.length,
        rate: cohort.length ? moved.length / cohort.length : null,
        from: days.length ? dayToIso(Math.min(...days)) : null,
        to: dayToIso(cutoff),
        tooYoung: entered.length - cohort.length,
        medianDays: median(/** @type {number[]} */ (durations)),
        timed: durations.length,
        stillHere: deals.filter((d) => d.stageIndex === i && d.entered.has(i)).length,
      };
    });
  // Für das Diagramm: wie viele Deals jede Phase je erreicht haben (laut Historie).
  const reached = order
    .map((stage, i) => ({ stage, i }))
    .filter((x) => covered.has(x.i) && stageKind(x.stage) !== "lost")
    .map(({ stage, i }) => ({ stage, count: deals.filter((d) => d.entered.has(i)).length }));
  return { computable: /** @type {true} */ (true), maturityDays, steps, missing, reached };
}

/**
 * Abschlussquote nach Gruppe, nur aus abgeschlossenen Deals.
 * @param {Deal[]} deals
 * @param {"source" | "owner"} key
 * @param {number} minGroup
 */
function winRates(deals, key, minGroup) {
  const closed = deals.filter((d) => d.kind === "won" || d.kind === "lost");
  if (!closed.length) return null;
  const won = closed.filter((d) => d.kind === "won").length;
  /** @type {Map<string, { won: number, closed: number }>} */
  const groups = new Map();
  for (const d of closed) {
    const g = d[key] || "(empty)";
    const x = groups.get(g) ?? { won: 0, closed: 0 };
    x.closed++;
    if (d.kind === "won") x.won++;
    groups.set(g, x);
  }
  const rows = [...groups].map(([name, x]) => ({ name, ...x, rate: x.won / x.closed })).sort((a, b) => b.closed - a.closed);
  return {
    overall: { won, closed: closed.length, rate: won / closed.length },
    groups: rows.filter((r) => r.closed >= minGroup),
    small: rows.filter((r) => r.closed < minGroup).length,
    minGroup,
  };
}

/**
 * @param {{ header: string[], rows: string[][] }} table
 * @param {Mapping} map
 * @param {HistoryColumn[]} history
 * @param {string[]} order
 * @param {Partial<typeof DEFAULTS> & { asOf?: number }} [options]
 */
export function audit(table, map, history, order, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const deals = readDeals(table.rows, map, history, order);
  const asOf = options.asOf ?? latestDay(deals);
  if (map.stage < 0) return { ok: /** @type {false} */ (false), error: "Pick the column that holds the current stage." };
  if (asOf === null) return { ok: /** @type {false} */ (false), error: "No readable date in this file. Pick a created date or another date column." };

  const snap = snapshot(deals, order);
  const age = ages(deals, order, asOf, o.oldDays);
  const stall = stalled(deals, map, asOf, o.stalledDays);
  const fl = flow(deals, order, history, asOf, o.maturityDays);
  const hasClosed = order.some((s) => stageKind(s) !== "open");
  const bySource = map.source >= 0 && hasClosed ? winRates(deals, "source", o.minGroup) : null;
  const byOwner = map.owner >= 0 && hasClosed ? winRates(deals, "owner", o.minGroup) : null;
  const gap = gaps(deals, map);

  /** @type {Finding[]} */
  const findings = [];
  if (stall.computable && stall.of >= o.minGroup) {
    findings.push({
      title: `${deals_(stall.count)} ${has(stall.count)} gone quiet`,
      sentence: `${stall.count} of ${stall.of} open deals with an activity date have had no activity for more than ${stall.days} days. Together they are worth ${money(stall.amount)}.`,
      share: stall.count / stall.of,
      calc: [
        `Open deals with a last activity date: ${stall.of}`,
        `Last activity before ${dayToIso(asOf - stall.days)} (${stall.days} days before ${dayToIso(asOf)}): ${stall.count}`,
        `Share: ${stall.count} / ${stall.of} = ${pct(stall.count, stall.of)}`,
        `Amount of those deals: ${money(stall.amount)}`,
        stall.unknown ? `Not counted: ${deals_(stall.unknown)} without a last activity date` : "",
      ].filter(Boolean),
    });
  }
  if (fl.computable) {
    const candidates = fl.steps.filter((s) => s.rate !== null && s.cohort >= o.minCohort);
    const worst = candidates.sort((a, b) => /** @type {number} */ (a.rate) - /** @type {number} */ (b.rate))[0];
    if (worst && worst.rate !== null) {
      findings.push({
        title: `Deals stall after ${worst.stage}`,
        sentence: `Only ${pct(worst.moved, worst.cohort)} of deals that entered ${worst.stage} moved on to ${worst.next} or later. That is the weakest step in the funnel.`,
        share: 1 - worst.rate,
        calc: [
          `Deals that entered ${worst.stage} between ${worst.from} and ${worst.to}: ${worst.cohort}`,
          `Of these, reached ${worst.next} or a later stage (not lost): ${worst.moved}`,
          `Rate: ${worst.moved} / ${worst.cohort} = ${pct(worst.moved, worst.cohort)}`,
          `Not counted: ${worst.tooYoung} deals that entered ${worst.stage} less than ${fl.maturityDays} days before ${dayToIso(asOf)}`,
        ],
      });
    }
  }
  if (age.dated >= o.minGroup) {
    findings.push({
      title: `${deals_(age.old)} ${is(age.old)} older than ${age.oldDays} days`,
      sentence: `${age.old} of ${age.dated} open deals were created more than ${age.oldDays} days ago and are still open, worth ${money(age.oldAmount)}.`,
      share: age.old / age.dated,
      calc: [
        `Open deals with a created date: ${age.dated}`,
        `Created before ${dayToIso(asOf - age.oldDays)}: ${age.old}`,
        `Share: ${age.old} / ${age.dated} = ${pct(age.old, age.dated)}`,
        age.undated ? `Not counted: ${deals_(age.undated)} without a readable created date` : "",
      ].filter(Boolean),
    });
  }
  for (const g of gap) {
    if (g.of < o.minGroup || !g.count) continue;
    findings.push({
      title: g.label,
      sentence: `${g.count} of ${g.of} (${pct(g.count, g.of)}). These deals drop out of every number that needs this field.`,
      share: g.count / g.of,
      calc: [`${g.label}: ${g.count}`, `Out of: ${g.of}`, `Share: ${pct(g.count, g.of)}`, `Rows in the file: ${g.rows.slice(0, 12).join(", ")}${g.rows.length > 12 ? " …" : ""}`],
    });
  }
  const ranked = findings.filter((f) => f.share >= o.minShare).sort((a, b) => b.share - a.share).slice(0, 3);

  return {
    ok: /** @type {true} */ (true),
    asOf: dayToIso(asOf),
    deals: deals.length,
    snapshot: snap,
    age,
    stalled: stall,
    flow: fl,
    bySource,
    byOwner,
    gaps: gap,
    fixFirst: ranked,
    options: o,
  };
}
