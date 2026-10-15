# HEPA – Nutrition/Food Tracker App (Design)

## Purpose

A local, offline-capable PWA for a single Android phone that logs food intake
(calories, protein/carbs/fat/fiber/sugar) via Open Food Facts lookup or manual
entry, primarily to surface **long-term eating trends** (daily/weekly
patterns, goal adherence, correlation with HTPA's bodyweight log) rather than
being a precision nutrition-logging tool. Day-to-day visibility (what did I
eat today, how many calories so far) still matters, but it's secondary to the
trend/history view.

Explicitly **not** in scope: meal-time categorization (entries are a flat
chronological list per day, no breakfast/lunch/dinner/snack tagging),
barcode scanning (text search only), recipe/multi-ingredient composition,
social features, multi-user support, cloud sync.

Technical cornerstones are reused directly from the HNSA/HTPA projects
(`docs/superpowers/specs/2026-10-14-hnsa-stundenplan-design.md` and
`2026-10-15-htpa-training-tracker-design.md` in those repos): vanilla JS, no
framework, no build step, `localStorage` persistence, one responsibility per
JS module, PWA manifest + service worker for offline/installability, GitHub
Pages hosting, a local `server.js` for dev/phone testing on the same network.
The one architectural departure from that pattern: HEPA makes live network
calls to the Open Food Facts API during food search (see Data model and
Error handling below for how the rest of the app stays fully usable offline
regardless).

## Data model

Stored in `localStorage` under one key (`hepa_nutrition_v1`) as a single JSON
object:

```js
{
  entries: [
    {
      id: "uuid",
      date: "2026-10-15",            // ISO date this entry counts toward
      loggedAt: "2026-10-15T14:32:00.000Z",  // for ordering + recency in quick-add
      name: "Banana",                 // display name (from OFF product, or typed for manual)
      source: "off",                  // "off" | "manual"
      offId: "0000000031000",         // only when source === "off"; the OFF product code
      base: {                         // only when source === "off"; nutrients PER 100g,
                                       // exactly as looked up — an immutable snapshot, never
                                       // re-fetched/updated after logging
        calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2
      },
      quantity: { mode: "grams", grams: 150 },
      // or: { mode: "serving", servings: 1, gramsPerServing: 118, label: "1 medium banana" }
      nutrients: {                    // only when source === "manual"; absolute totals as
                                       // typed — no scaling, this IS what was eaten
        calories: 450, protein: 30, carbs: 40, fat: 15, fiber: null, sugar: null
      }
    }
  ],
  targets: [
    // History of target changes, not a single mutable value. "The target active for
    // date D" = the entry with the latest effectiveFrom <= D (or none, if D predates
    // every entry). Editing targets in Settings appends a new entry here; it never
    // mutates or removes a previous one. This is what makes targets "optional and
    // editable" while still letting past days in Trends compare against whatever
    // target was actually active on that day.
    { effectiveFrom: "2026-10-01", calories: 2200, protein: 150, carbs: 220, fat: 70 }
    // any of calories/protein/carbs/fat may be null/omitted on a given entry — a day
    // with no value for a given field simply has no goal comparison for that field
  ]
}
```

Key decisions baked into this shape:

- **OFF entries store the per-100g `base` + `quantity`, not pre-scaled
  totals.** Actual nutrients for display/trends/aggregation are always
  *derived* from `base × quantity` by a pure function in `store.js`, the same
  "derive at read time" philosophy HTPA uses for PRs and distinct exercise
  names. This also makes editing a logged portion later (e.g. "I actually ate
  200g not 150g") a one-field change instead of a recompute-and-overwrite.
- **Manual entries store absolute totals directly** (no `base`/`quantity`)
  since there's nothing to scale — what's typed is the total for what was
  eaten.
- **`targets` is a changelog, not a single value**, for the snapshot-per-day
  requirement without duplicating target data onto every entry.
- **No meal-of-day field** — entries are purely chronological per date.
- `entries` and `targets` are independent arrays, same pattern as HTPA's
  `sessions`/`bodyweight` split. Multiple entries on the same date are
  expected and unrestricted — no dedup/merge logic.

### Cross-app read: HTPA bodyweight

For the Trends weight overlay, `store.js` also does a **read-only** lookup of
`localStorage.getItem('htpa_training_v1')` (HTPA and HEPA share an origin —
`michaelrib25-droid.github.io` — so this works with no extra setup) and
extracts its `.bodyweight` array. HEPA never writes to this key and never
assumes it exists; see Error handling below for the missing/absent case.

## Components / file structure

```
HEPA/
  index.html           Entry page; loads manifest.json, service-worker.js, js/app.js
  manifest.json         PWA manifest (already in place; name/short_name updated for
                        the real app)
  service-worker.js     Offline cache (asset list extended for css/js files below).
                        Open Food Facts API requests are never in the cached asset
                        list, so the existing cache.match-else-fetch handler already
                        passes them straight to the network untouched — no special
                        casing needed.
  css/styles.css         Styling, extends the existing dark palette (#1a1a2e bg,
                        #22223b surface, #44446a border, #f5f5f7 text, #a0a0b0 muted,
                        #4f6df5 accent, #ff6b6b error)
  js/
    app.js               Entry point: initializes store, renders the active tab,
                         wires the 4-tab nav
    store.js             Reads/writes localStorage (hepa_nutrition_v1); CRUD for
                         entries & targets; derives daily/weekly aggregates,
                         recent/frequent foods, "target active for date D"; read-only
                         reach into HTPA's htpa_training_v1 for the bodyweight overlay
    foodSearch.js         Open Food Facts fetch wrapper: search-by-name, normalizes
                         the response into {name, offId, per100g nutrients, serving
                         info}
    chart.js              Hand-rolled inline-SVG line chart, extended from HTPA's
                         version to support multiple series (calories+macros, or
                         calories+weight dual-axis overlay)
    logView.js            "Log" tab: search box (debounced OFF search) + recent/
                         frequent quick-add list + manual-entry fallback form +
                         portion entry
    historyView.js        "History" tab: entries grouped by day, expand/edit-
                         quantity/delete
    trendsView.js          "Trends" tab: daily calories+macros chart, weekly/monthly
                         average toggle, weight overlay, over/under-goal streak
    settingsView.js        "Settings" tab: edit calorie/macro targets (appends to
                         the targets changelog)
  icons/                 (reused from the hello-world placeholder)
  server.js              Local dev server (same pattern as HNSA/HTPA)
  .githooks/
    pre-commit            Reused from HTPA: auto-bumps CACHE_NAME in
                         service-worker.js on every commit that touches app files
```

Same module discipline as HTPA: `store.js` owns all `localStorage` access
(including the cross-app HTPA read) and has no knowledge of the DOM; view
modules never touch storage directly, only through the `store.js` API.
`app.js` is the only module that switches between tabs, re-rendering into a
single `#app` container.

## Navigation

Four tabs, same single-container switching pattern as HTPA: **Log / History /
Trends / Settings**. Settings gets its own tab rather than a hidden icon,
keeping with the existing "every screen is a tab" convention from HNSA/HTPA.

## Interaction flow per tab

- **Log:** Search box at top → debounced calls to `foodSearch.js` (Open Food
  Facts) → tap a result → portion entry (grams by default, or servings if OFF
  reports a serving size) → Save appends an `entries` row for today (date
  defaults to today, editable). Above the search box, a **recent/frequent**
  row of recently/often-logged foods (derived from `entries`, ranked by a mix
  of recency and frequency) lets you re-log in one tap, landing on the same
  portion-entry step pre-filled with the last-used quantity. A **"Can't find
  it / add manually"** link drops into a plain form (name + calories/protein/
  carbs/fat, fiber/sugar optional) that saves a `source: "manual"` entry.
- **History:** Entries grouped by day, most recent first, each day header
  showing that day's total calories. Tap a day to expand its entries; tap an
  entry to edit its quantity (OFF entries) or its typed numbers (manual
  entries), or delete it.
- **Trends:** Chart of daily calories + macros over a selectable range (e.g.
  last 30/90 days), a toggle between daily points and weekly/monthly
  averages, an optional weight line overlaid (dual y-axis, since weight and
  calories sit on very different scales) pulled from HTPA's bodyweight log,
  and an "on target N of last M days" stat. The goal-streak stat only
  renders once at least one `targets` entry exists; the weight overlay only
  renders once HTPA's key exists with data — both degrade by simply not
  rendering that piece, never by erroring.
- **Settings:** Form for calorie/protein/carb/fat targets, each independently
  optional (blank = no target for that field). Saving appends a new entry to
  the `targets` changelog with `effectiveFrom` = today.

## Edge cases & error handling

- **OFF search fails** (offline, timeout, no results): inline message in Log
  ("No results / couldn't reach the food database — add manually"); the
  search box and manual-entry fallback stay usable. Nothing else in the app
  depends on network, so being offline never blocks logging via quick-add or
  manual entry.
- **First start (no entries yet):** Log's recent/frequent list, History, and
  Trends all show an empty-state hint instead of a blank screen, same
  convention as HNSA/HTPA.
- **HTPA's `htpa_training_v1` key doesn't exist** (HTPA never opened on this
  phone, or its storage format changes): the weight overlay silently omits
  itself rather than erroring — it's a best-effort enhancement, not a
  dependency.
- **Deleting/editing an entry:** daily/weekly totals, the recent/frequent
  list, and the goal streak are all derived at read time from `entries`, so
  no separate cleanup step is needed elsewhere.
- **No target ever set for a date:** goal-related UI (progress indicators,
  streak) simply doesn't render for days with no applicable target snapshot.
- **`localStorage` unavailable** (e.g. private browsing): no special-cased
  handling, same reasoning as HNSA/HTPA — the app loses persistence for that
  session only. Not worth engineering around for an installed PWA that
  always runs outside private mode.

## Testing

No automated test suite, same reasoning as HNSA/HTPA: disproportionate for
an offline single-user app. Manual testing via `node server.js` locally, plus
live testing on the phone over the same network/installed PWA.

## Deployment automation

Reuses HTPA's `.githooks/pre-commit` hook (`core.hooksPath=.githooks`): on
every commit touching app files, it rewrites `CACHE_NAME` in
`service-worker.js` to a fresh value and stages that change into the same
commit automatically, so pushes redeploy via GitHub Pages and the installed
PWA auto-updates without a manual edit or reinstall.
