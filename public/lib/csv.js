// CSV lesen, ohne Bibliothek. Deutsche Excel-Exporte trennen mit Semikolon,
// andere mit Komma oder Tab. Das Trennzeichen wird an der Kopfzeile erkannt.

/**
 * @param {string} line
 * @returns {string}
 */
function guessDelimiter(line) {
  /** @type {Record<string, number>} */
  const count = { ",": 0, ";": 0, "\t": 0 };
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch in count) count[ch] = (count[ch] ?? 0) + 1;
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ",";
}

/**
 * @param {string} text
 * @returns {{ header: string[], rows: string[][], delimiter: string }}
 */
export function parseCsv(text) {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = guessDelimiter(firstLine);
  /** @type {string[][]} */
  const table = [];
  /** @type {string[]} */
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      table.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    table.push(row);
  }
  const nonEmpty = table.filter((r) => r.some((c) => c.trim() !== ""));
  const header = (nonEmpty.shift() ?? []).map((h) => h.trim());
  return { header, rows: nonEmpty, delimiter };
}
