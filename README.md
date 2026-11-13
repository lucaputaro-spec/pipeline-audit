# Pipeline Audit: where do deals leak?

Drop a CRM deal export (CSV) and see where deals get stuck. Every figure shows
its numerator, denominator and period, so it can be checked by hand. Runs
entirely in the browser: the file is never uploaded, and the site has no
server code.

## Two kinds of export, two kinds of answers

- **A plain deal export** (one row per deal, current stage) shows where deals
  are now: open value per stage, age of open deals, data gaps, win rates by
  source and owner. With a last activity column it also finds stalled deals.
- **A stage history** ("Date entered <stage>" columns, as HubSpot exports
  them) adds stage-to-stage conversion and time in stage. Without it, those
  numbers are marked as not computable, with the missing columns named.

Conversion uses mature cohorts: only deals that entered a stage at least 60
days before the last date in the file count, and the page says how many
younger ones were left out. The reference date is the latest date in the
file, so results do not change with the day you open them.

"Fix these first" ranks findings by one rule: the share of deals affected.
Findings below 10%, or based on fewer than 5 deals, are not ranked.

## Examples

Both examples are made up. One has 400 deals with stage history and leaks
built in on purpose (generated from a fixed seed). The other is a small German
export with semicolons, German dates, other column names and missing values.

## Stack

Plain HTML, CSS and ES modules, no build step, served as static files from
Cloudflare Workers. Vitest for the calculations.

## Run it

```bash
npm install
npm run dev
npm run test:run && npm run typecheck && npm run lint
```
