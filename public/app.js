// Die Seite. Alles läuft hier im Browser: die Datei wird gelesen, aber nie
// verschickt. Es gibt keinen fetch()-Aufruf mit Daten. Inhalte aus der Datei
// werden nur als Text eingesetzt, nie als HTML.

import { audit } from "./lib/audit.js";
import { defaultOrder, detectColumns, FIELDS, historyColumns, stageKind } from "./lib/columns.js";
import { parseCsv } from "./lib/csv.js";
import { exampleWithHistory, GERMAN_EXPORT } from "./lib/sample.js";

const $ = (sel) => document.querySelector(sel);

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === null || kid === undefined || kid === false || kid === "") continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const money = (n) => Math.round(n).toLocaleString("en-US");
const pct = (n, d) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "–");
const days = (n) => (n === null ? "–" : `${Math.round(n * 10) / 10} days`);

let state = null; // { name, table, map, history, order }

/* ---------- Laden ---------- */

function load(name, text) {
  const table = parseCsv(text);
  if (!table.header.length || !table.rows.length) {
    showLoaded(`${name}: no rows found. Is this a CSV file with a header row?`, true);
    return;
  }
  const map = detectColumns(table.header);
  const history = historyColumns(table.header);
  state = { name, table, map, history, order: [] };
  state.order = currentOrder();
  showLoaded(`${name}: ${table.rows.length} rows, ${table.header.length} columns, separated by “${table.delimiter === "\t" ? "tab" : table.delimiter}”.`);
  drawColumns();
  drawResults();
  $("#columns-section").scrollIntoView({ behavior: "smooth", block: "start" });
}

function currentOrder() {
  const { table, map, history } = state;
  const values = map.stage >= 0 ? table.rows.map((r) => r[map.stage] ?? "") : [];
  return defaultOrder(values, history);
}

function showLoaded(text, bad = false) {
  const box = $("#loaded");
  box.hidden = false;
  box.className = bad ? "error" : "loaded";
  box.textContent = text;
}

$("#file").addEventListener("change", async (e) => {
  const f = e.target.files?.[0];
  if (f) load(f.name, await f.text());
});
const drop = $("#drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files?.[0];
  if (f) load(f.name, await f.text());
});
$("#ex-history").addEventListener("click", () => load("Made-up example (400 deals with stage history)", exampleWithHistory()));
$("#ex-german").addEventListener("click", () => load("Made-up example (German export, no history)", GERMAN_EXPORT));

/* ---------- Spalten ---------- */

function drawColumns() {
  const { table, map, history } = state;
  $("#columns-section").hidden = false;
  $("#mapping").replaceChildren(
    ...FIELDS.map((f) => {
      const select = h(
        "select",
        { "data-field": f.key },
        h("option", { value: "-1" }, "Not in this file"),
        table.header.map((name, i) => h("option", { value: String(i) }, name || `(column ${i + 1})`)),
      );
      select.value = String(map[f.key]);
      select.addEventListener("change", () => {
        map[f.key] = Number(select.value);
        if (f.key === "stage") state.order = currentOrder();
        drawColumns();
        drawResults();
      });
      return h("label", null, f.key === "stage" ? `${f.label} (required)` : f.label, select);
    }),
  );
  $("#history-note").replaceChildren(
    history.length
      ? h("span", null, h("strong", null, `Stage history found: ${history.length} columns. `), history.map((c) => table.header[c.index]).join(", "))
      : h("span", null, h("strong", null, "No stage history in this file. "), "Columns like “Date entered Demo” would unlock conversion and time in stage."),
  );
  $("#order").replaceChildren(
    ...state.order.map((s, i) => {
      const move = (by) => () => {
        const o = state.order;
        [o[i], o[i + by]] = [o[i + by], o[i]];
        drawColumns();
        drawResults();
      };
      return h(
        "li",
        null,
        h("span", null, `${i + 1}. ${s}`, stageKind(s) === "open" ? "" : ` (${stageKind(s)})`),
        i > 0 ? withClick(h("button", { type: "button", "aria-label": `Move ${s} up` }, "↑"), move(-1)) : null,
        i < state.order.length - 1 ? withClick(h("button", { type: "button", "aria-label": `Move ${s} down` }, "↓"), move(1)) : null,
      );
    }),
  );
}

function withClick(el, fn) {
  el.addEventListener("click", fn);
  return el;
}

/* ---------- Ergebnisse ---------- */

function notComputable(title, r) {
  return h(
    "div",
    { class: "na" },
    h("strong", null, `${title}: not computable from this file`),
    h("p", null, r.why),
    h("p", null, "Missing: ", r.needs.map((n, i) => [i ? ", " : "", h("code", null, n)])),
  );
}

function drawResults() {
  const out = $("#results");
  out.hidden = false;
  const r = audit(state.table, state.map, state.history, state.order);
  if (!r.ok) {
    out.replaceChildren(h("h2", null, "2. Findings"), h("p", { class: "error" }, r.error));
    return;
  }
  const s = r.snapshot;
  const won = s.stages.filter((x) => x.kind === "won").reduce((a, x) => a + x.count, 0);
  out.replaceChildren(
    h("h2", null, "2. Fix these first"),
    h("p", { class: "sub" }, `Ranked by the share of deals affected. Reference date: ${r.asOf}, the latest date in the file.`),
    h(
      "div",
      { class: "tiles" },
      tile(r.deals, "deals in the file"),
      tile(s.openCount, "open deals"),
      tile(money(s.openAmount), "open value (known amounts)"),
      tile(won, "won deals"),
    ),
    r.fixFirst.length
      ? h(
          "ol",
          { class: "fix" },
          r.fixFirst.map((f) =>
            h("li", null, h("strong", null, f.title), h("p", null, f.sentence), h("details", null, h("summary", null, "Show the calculation"), h("ol", null, f.calc.map((c) => h("li", null, c))))),
          ),
        )
      : h("p", { class: "muted" }, "No finding affects 10% or more of the deals it is measured on."),
    funnelSection(r),
    stalledSection(r),
    snapshotSection(r),
    groupsSection(r),
    gapsSection(r),
  );
}

function tile(value, label) {
  return h("div", { class: "tile" }, h("b", null, String(value)), h("span", null, label));
}

function bars(rows) {
  const max = Math.max(1, ...rows.map((x) => x.value));
  return h(
    "div",
    { class: "funnel", role: "img", "aria-label": rows.map((x) => `${x.label}: ${x.text}`).join(", ") },
    rows.map((x) => {
      const w = (x.value / max) * 100;
      return h(
        "div",
        { class: "bar-row", title: `${x.label}: ${x.text}` },
        h("span", null, x.label),
        h("span", { class: "track" }, h("span", { class: "fill", style: `width:${w}%` }), h("span", { class: "val", style: w > 70 ? `right:${100 - w}%;margin-right:8px;color:var(--sheet)` : `left:calc(${w}% + 8px)` }, x.text)),
      );
    }),
  );
}

function funnelSection(r) {
  const f = r.flow;
  if (!f.computable) {
    return h(
      "div",
      { class: "section" },
      h("h2", null, "Stage conversion"),
      notComputable("Conversion between stages and time in stage", f),
    );
  }
  return h(
    "div",
    { class: "section" },
    h("h2", null, "Stage conversion"),
    h("p", { class: "sub" }, "How many deals ever reached each stage, from the stage history."),
    bars(f.reached.map((x) => ({ label: x.stage, value: x.count, text: `${x.count} deals` }))),
    h(
      "div",
      { class: "tablewrap" },
      h(
        "table",
        { class: "data" },
        h("thead", null, h("tr", null, ["From stage", "Entered in period", "Period", "Moved on", "Rate", "Left out (too recent)", "Median time in stage", "Based on"].map((t, i) => h("th", { class: i && i !== 2 ? "num" : "" }, t)))),
        h(
          "tbody",
          null,
          f.steps.map((x) =>
            h(
              "tr",
              null,
              h("td", null, `${x.stage} → ${x.next}`),
              h("td", { class: "num" }, x.cohort),
              h("td", null, x.from ? `${x.from} to ${x.to}` : "–"),
              h("td", { class: "num" }, x.moved),
              h("td", { class: "num" }, x.rate === null ? "–" : `${x.moved} / ${x.cohort} = ${pct(x.moved, x.cohort)}`),
              h("td", { class: "num" }, x.tooYoung),
              h("td", { class: "num" }, days(x.medianDays)),
              h("td", { class: "num" }, `${x.timed} deals that left`),
            ),
          ),
        ),
      ),
    ),
    h("p", { class: "muted" }, `Moved on means the deal reached the next stage or any later one (lost does not count). Only deals that entered a stage at least ${f.maturityDays} days before ${r.asOf} are counted, so recent deals do not drag the rate down.`),
    f.missing.length ? notComputable("Some stages", { why: "These stages have no history column, so they are left out of the table above.", needs: f.missing }) : null,
  );
}

function stalledSection(r) {
  const st = r.stalled;
  if (!st.computable) return h("div", { class: "section" }, h("h2", null, "Stalled deals"), notComputable("Stalled deals", st));
  return h(
    "div",
    { class: "section" },
    h("h2", null, "Stalled deals"),
    h("p", { class: "sub" }, `${st.count} of ${st.of} open deals had no activity for more than ${st.days} days before ${r.asOf} (${pct(st.count, st.of)}), worth ${money(st.amount)}.${st.unknown ? ` ${st.unknown} open ${st.unknown === 1 ? "deal has" : "deals have"} no activity date and ${st.unknown === 1 ? "is" : "are"} not counted.` : ""}`),
    st.worst.length
      ? h(
          "div",
          { class: "tablewrap" },
          h(
            "table",
            { class: "data" },
            h("thead", null, h("tr", null, ["Deal", "Stage", "Owner", "Last activity", "Amount"].map((t, i) => h("th", { class: i === 4 ? "num" : "" }, t)))),
            h("tbody", null, st.worst.map((d) => h("tr", null, h("td", null, d.id), h("td", null, d.stage), h("td", null, d.owner || "–"), h("td", null, d.lastRaw), h("td", { class: "num" }, d.amount === null ? "–" : money(d.amount))))),
          ),
        )
      : null,
  );
}

function snapshotSection(r) {
  const s = r.snapshot;
  const open = s.stages.filter((x) => x.kind === "open");
  const age = new Map(r.age.byStage.map((x) => [x.stage, x]));
  return h(
    "div",
    { class: "section" },
    h("h2", null, "Where deals are now"),
    h("p", { class: "sub" }, "Open deals by current stage. This works with any export and is a snapshot, not a funnel: it does not say how deals got here."),
    bars(open.map((x) => ({ label: x.stage, value: x.count, text: `${x.count} deals, ${money(x.amount)}` }))),
    h(
      "div",
      { class: "tablewrap" },
      h(
        "table",
        { class: "data" },
        h("thead", null, h("tr", null, ["Stage", "Deals", "Value (known amounts)", "Without amount", "Median age of open deals"].map((t, i) => h("th", { class: i ? "num" : "" }, t)))),
        h(
          "tbody",
          null,
          s.stages.map((x) =>
            h(
              "tr",
              null,
              h("td", null, x.kind === "open" ? x.stage : `${x.stage} (${x.kind})`),
              h("td", { class: "num" }, x.count),
              h("td", { class: "num" }, money(x.amount)),
              h("td", { class: "num" }, x.missingAmount),
              h("td", { class: "num" }, x.kind === "open" ? `${days(age.get(x.stage)?.medianDays ?? null)} (${age.get(x.stage)?.count ?? 0} with a date)` : "–"),
            ),
          ),
        ),
      ),
    ),
    s.unmatched ? h("p", { class: "muted" }, `${s.unmatched} deals have a stage that is not in the stage order above and are left out.`) : null,
  );
}

function groupTable(title, g) {
  if (!g) return h("div", null, h("h3", null, title), h("p", { class: "muted" }, "Needs this column and won or lost stages."));
  return h(
    "div",
    null,
    h("h3", null, title),
    h("p", { class: "muted" }, `All closed deals: ${g.overall.won} won of ${g.overall.closed} = ${pct(g.overall.won, g.overall.closed)}.`),
    g.groups.length
      ? h(
          "table",
          { class: "data" },
          h("thead", null, h("tr", null, h("th", null, "Group"), h("th", { class: "num" }, "Won / closed"), h("th", { class: "num" }, "Win rate"))),
          h("tbody", null, g.groups.map((x) => h("tr", null, h("td", null, x.name), h("td", { class: "num" }, `${x.won} / ${x.closed}`), h("td", { class: "num" }, pct(x.won, x.closed))))),
        )
      : null,
    g.small ? h("p", { class: "muted" }, `${g.small} groups with fewer than ${g.minGroup} closed deals are not shown. Rates on so few deals say little.`) : null,
  );
}

function groupsSection(r) {
  return h("div", { class: "section" }, h("h2", null, "By source and owner"), h("div", { class: "cols2" }, groupTable("Source", r.bySource), groupTable("Owner", r.byOwner)));
}

function gapsSection(r) {
  return h(
    "div",
    { class: "section" },
    h("h2", null, "Data gaps"),
    h("p", { class: "sub" }, "Every gap removes deals from the numbers above. Fixing the data is often the cheapest first step."),
    h(
      "div",
      { class: "tablewrap" },
      h(
        "table",
        { class: "data" },
        h("thead", null, h("tr", null, h("th", null, "Gap"), h("th", { class: "num" }, "Count"), h("th", { class: "num" }, "Share"), h("th", null, "Rows in the file"))),
        h("tbody", null, r.gaps.map((g) => h("tr", null, h("td", null, g.label), h("td", { class: "num" }, `${g.count} / ${g.of}`), h("td", { class: "num" }, pct(g.count, g.of)), h("td", null, g.rows.slice(0, 10).join(", ") + (g.rows.length > 10 ? " …" : ""))))),
      ),
    ),
  );
}
