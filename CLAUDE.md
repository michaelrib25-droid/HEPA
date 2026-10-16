# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HEPA: a local, offline-capable PWA for a single Android phone that logs food intake
(calories, protein/carbs/fat/fiber/sugar) via Open Food Facts lookup or manual entry.
Primarily meant to surface long-term eating trends (daily/weekly patterns, goal
adherence, correlation with the sibling HTPA project's bodyweight log) — day-to-day
visibility matters but is secondary to trends/history. Single-user, no backend beyond
the public Open Food Facts API, no cloud sync of its own data. Vanilla JS, no framework,
no build step.

Full design spec: `docs/superpowers/specs/2026-10-15-hepa-nutrition-tracker-design.md`.

## Commands

- Run locally: `node server.js` — serves the app at `http://localhost:8000` (also
  reachable from a phone on the same network via the machine's LAN IP, for installed-PWA
  testing).
- No build step, no test suite, no linter. Testing is manual: load in a browser and/or
  on the phone as an installed PWA.

## Deployment

Hosted on GitHub Pages. Deploy = commit + push to `main`; Pages rebuilds automatically.

A tracked git hook (`core.hooksPath=.githooks`), reused from HTPA: `.githooks/pre-commit`
checks whether the commit touches any app file (anything other than
`service-worker.js`, `.githooks/*`, `docs/*`). If so, it rewrites `CACHE_NAME` in
`service-worker.js` to a fresh timestamp value and stages that change into the same
commit automatically — this is what makes the installed PWA's service worker pick up new
files after a deploy. Never hand-edit `CACHE_NAME` or bypass this hook. Always push after
committing so Pages rebuilds and the phone PWA updates.

## Architecture

Single-page app, one `#app` container, `app.js` is the only module that switches between
the 4 tabs (Log / History / Trends / Settings) and re-renders into it.

Strict layering, same discipline as HTPA/HNSA: `store.js` is the only module touching
`localStorage` (key `hepa_nutrition_v1`) and has no DOM knowledge; view modules
(`logView.js`, `historyView.js`, `trendsView.js`, `settingsView.js`) only talk to
`Store`, never to storage directly.

**The one architectural departure from HTPA/HNSA's fully-offline pattern:**
`foodSearch.js` makes live network calls to the Open Food Facts API during food search.
Nothing else in the app depends on network — OFF search failing (offline, timeout, no
results) must degrade to an inline message while the manual-entry fallback stays fully
usable. Don't let a network dependency leak into logging, history, or trends.

Data model nuances that drive a lot of the logic (`js/store.js`):
- Entries have two shapes depending on `source`:
  - `source: "off"` entries store `base` (nutrients **per 100g**, an immutable snapshot
    from the OFF lookup, never re-fetched/updated after logging) + `quantity`
    (`{mode:"grams", grams}` or `{mode:"serving", servings, gramsPerServing, label}`).
    Actual nutrients are always *derived* at read time via `deriveNutrients()` /
    `getEntryNutrients()` (`base × quantity`), the same derive-at-read-time philosophy
    HTPA uses for PRs. This makes correcting a logged portion a one-field edit instead of
    a recompute-and-overwrite.
  - `source: "manual"` entries store absolute `nutrients` totals directly — no
    `base`/`quantity`, nothing to scale.
  - Don't conflate the two shapes; always branch on `source` before reading nutrients.
- `targets` is a **changelog, not a single mutable value** — editing targets in Settings
  appends a new `{ effectiveFrom, calories, protein, carbs, fat }` entry rather than
  mutating the previous one. "The target active for date D" = the entry with the latest
  `effectiveFrom <= D` (`getTargetForDate()`). This lets Trends compare a past day
  against whatever target was actually active *then*, not today's target. Any of the
  four fields may be null — a day with no value for a field simply has no goal
  comparison for that field.
- `entries` and `targets` are independent arrays; multiple entries per date are expected
  and unrestricted, no dedup/merge logic (same pattern as HTPA's `sessions`/`bodyweight`).

**Cross-app read of HTPA's data:** for the Trends weight overlay, `store.js` does a
**read-only** lookup of `localStorage.getItem('htpa_training_v1')` and extracts its
`.bodyweight` array (`getHtpaBodyweightPoints()`). This works because HTPA and HEPA are
served from the same origin on GitHub Pages. HEPA must never write to that key, and must
treat its absence (HTPA never opened on this phone, or its format changed) as a normal
case — the weight overlay just silently omits itself, it's a best-effort enhancement, not
a dependency. If you ever change HTPA's `htpa_training_v1` shape, check this read site.

`chart.js` here is HTPA's hand-rolled inline-SVG line chart extended to support multiple
series (for the calories+macros chart and the calories+weight dual-axis overlay) — keep
changes compatible with both single- and multi-series callers.
