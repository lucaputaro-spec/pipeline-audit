// Spalten eines Exports den Feldern der Auswertung zuordnen. Die Seite rät
// zuerst selbst (englische und deutsche Namen), der Besucher kann korrigieren.

/** @typedef {"id" | "stage" | "amount" | "created" | "closed" | "lastActivity" | "source" | "owner"} Field */
/** @typedef {Record<Field, number>} Mapping  -1 heißt: nicht vorhanden */
/** @typedef {{ index: number, stage: string }} HistoryColumn */

/** @type {{ key: Field, label: string, names: string[] }[]} */
export const FIELDS = [
  { key: "stage", label: "Current stage", names: ["deal stage", "stage", "dealstage", "phase", "deal phase", "dealphase", "pipeline stage", "status"] },
  { key: "amount", label: "Amount", names: ["amount", "deal amount", "value", "deal value", "betrag", "wert", "umsatz", "volumen", "auftragswert"] },
  { key: "created", label: "Created date", names: ["create date", "created", "created date", "created at", "date created", "erstellt", "erstellt am", "anlagedatum", "angelegt am", "erstelldatum"] },
  { key: "closed", label: "Close date", names: ["close date", "closed date", "closed at", "abschlussdatum", "geschlossen am", "abschluss"] },
  { key: "lastActivity", label: "Last activity date", names: ["last activity date", "last activity", "last activity at", "letzte aktivitat", "letzte aktivität", "zuletzt bearbeitet", "letzter kontakt"] },
  { key: "source", label: "Source", names: ["original source", "source", "lead source", "deal source", "quelle", "herkunft", "kanal", "lead quelle"] },
  { key: "owner", label: "Owner", names: ["deal owner", "owner", "sales rep", "rep", "verantwortlich", "verantwortlicher", "besitzer", "vertriebler", "betreuer"] },
  { key: "id", label: "Deal ID or name", names: ["deal id", "record id", "id", "deal name", "name", "deal", "titel", "bezeichnung"] },
];

/**
 * @param {string} h
 * @returns {string}
 */
export function norm(h) {
  return h.toLowerCase().replace(/["'()]/g, " ").replace(/[^a-z0-9äöüß]+/g, " ").trim();
}

// „Date entered Demo (Sales Pipeline)“ ist das Format von HubSpot. Dazu ein
// paar naheliegende Varianten, auch deutsch.
const HISTORY = [
  /^date entered\s+(.+)$/i,
  /^entered\s+(.+)$/i,
  /^(.+?)\s+entered( at| date)?$/i,
  /^datum eintritt\s+(.+)$/i,
  /^eintritt\s+(.+)$/i,
  /^(.+?)\s+seit$/i,
];

/**
 * @param {string[]} header
 * @returns {HistoryColumn[]}
 */
export function historyColumns(header) {
  /** @type {HistoryColumn[]} */
  const out = [];
  header.forEach((raw, index) => {
    const h = raw.replace(/["“”']/g, "").trim();
    for (const re of HISTORY) {
      const m = h.match(re);
      if (m) {
        const stage = (m[1] ?? "").replace(/\s*\([^)]*\)\s*$/, "").replace(/^[:\-\s]+/, "").trim();
        if (stage) out.push({ index, stage });
        return;
      }
    }
  });
  return out;
}

/**
 * @param {string[]} header
 * @returns {Mapping}
 */
export function detectColumns(header) {
  const history = new Set(historyColumns(header).map((c) => c.index));
  const names = header.map(norm);
  const used = new Set(history);
  /** @type {Mapping} */
  const map = { id: -1, stage: -1, amount: -1, created: -1, closed: -1, lastActivity: -1, source: -1, owner: -1 };
  for (const f of FIELDS) {
    let at = -1;
    for (const want of f.names) {
      at = names.findIndex((n, i) => !used.has(i) && n === norm(want));
      if (at >= 0) break;
    }
    if (at >= 0) {
      map[f.key] = at;
      used.add(at);
    }
  }
  return map;
}

/**
 * @param {string} stage
 * @returns {"won" | "lost" | "open"}
 */
export function stageKind(stage) {
  const s = stage.toLowerCase();
  if (/\b(won|gewonnen)\b/.test(s)) return "won";
  if (/\b(lost|verloren|abgesagt)\b/.test(s)) return "lost";
  return "open";
}

/**
 * Reihenfolge der Phasen: aus der Historie, sonst in der Reihenfolge des
 * ersten Auftretens. Gewonnen und Verloren immer ans Ende.
 * @param {string[]} current  Phasenwerte aus der Spalte „aktuelle Phase“
 * @param {HistoryColumn[]} history
 * @returns {string[]}
 */
export function defaultOrder(current, history) {
  /** @type {string[]} */
  const seen = [];
  for (const s of [...history.map((h) => h.stage), ...current]) {
    const t = s.trim();
    if (t && !seen.some((x) => x.toLowerCase() === t.toLowerCase())) seen.push(t);
  }
  const rank = (/** @type {string} */ s) => ({ open: 0, won: 1, lost: 2 })[stageKind(s)];
  return seen.map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}
