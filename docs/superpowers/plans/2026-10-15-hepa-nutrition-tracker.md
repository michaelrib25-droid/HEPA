# HEPA Nutrition Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the HEPA PWA — a local, offline-capable food/nutrition logger (Open Food Facts lookup or manual entry) with daily/weekly trend charts, optional calorie/macro targets, and a bodyweight overlay read from HTPA's data.

**Architecture:** Vanilla HTML/CSS/JS (ES modules), no build step, no framework. `store.js` owns all `localStorage` persistence (`hepa_nutrition_v1`) plus every read-time derivation (nutrient scaling, daily/weekly totals, goal streak, recent/frequent foods) and a read-only reach into HTPA's `htpa_training_v1` key for the bodyweight overlay. `foodSearch.js` is the sole module that talks to the network (Open Food Facts). `chart.js` is a single hand-rolled inline-SVG multi-series line chart reused by Trends for both the calories/macros chart and the calories+weight overlay. Each of the four tab view modules (`logView.js`, `historyView.js`, `trendsView.js`, `settingsView.js`) owns its whole tab; only cross-tab navigation bubbles up to `app.js`, which owns tab-switching state and the top-level render loop.

**Tech Stack:** Plain JavaScript (ES modules), HTML5, CSS3, a 40-line Node static file server for local testing (no npm dependencies), the Open Food Facts public search API (keyless, network calls only from `foodSearch.js`), Service Worker for offline caching, a git `pre-commit` hook (POSIX shell) for cache-busting on deploy.

**Spec:** `docs/superpowers/specs/2026-10-15-hepa-nutrition-tracker-design.md`

## Global Constraints

- No build tools/frameworks — plain vanilla HTML/CSS/JS using native ES modules.
- All persistence is local only, via `localStorage` under the single key `hepa_nutrition_v1`, except one read-only cross-app read of HTPA's `htpa_training_v1` key for the bodyweight overlay — HEPA never writes to that key.
- OFF (Open Food Facts) entries store the per-100g `base` nutrients + `quantity` (immutable snapshot of the lookup); actual nutrients are always *derived* at read time via `base × quantity`, never stored pre-scaled. Manual entries store absolute totals directly (no `base`/`quantity`).
- `targets` is an append-only changelog (`{ effectiveFrom, calories, protein, carbs, fat }`), not a single mutable value — "the target active for date D" = the entry with the latest `effectiveFrom <= D`.
- No meal-of-day field — entries are a flat chronological list per date.
- No automated test suite — the spec explicitly rejects one as disproportionate for a single-user offline app. Each task below is verified manually in the browser (desktop first, then phone) instead of with `assert`/test-runner code.
- Scope excludes meal categorization, barcode scanning, recipe/multi-ingredient composition, social features, multi-user support, cloud sync.
- The real project repo (`https://github.com/michaelrib25-droid/HEPA`, GitHub Pages already enabled at `https://michaelrib25-droid.github.io/HEPA/`) already exists and contains the hello-world pipeline-test skeleton (`index.html`, `manifest.json` with `"id": "/HEPA/"`, `service-worker.js`, `icons/`) plus the approved spec — this plan replaces/extends that skeleton in place, it does not start a new repo.

## Review Focus

- OFF search failing (offline, timeout, no results) must never block logging — the recent/frequent quick-add list and the manual-entry fallback form must stay fully usable. Covered in Task 6.
- First start with zero entries/targets — Log's recent/frequent row, History, Trends (chart + goal streak), and Settings must all show helpful empty-state messaging instead of a blank or broken screen. Covered across Tasks 6, 7, 8, 9.
- Editing a logged OFF entry's quantity (grams or servings) must change its derived nutrients consistently everywhere (History's daily total, Trends' chart, the goal streak) without a stale cached value surviving anywhere — nothing may store pre-scaled nutrients for OFF entries. Covered in Task 2, re-verified in Task 7.
- No target ever set (or none active for a given date) must make all goal-related UI (Settings' current-target display, Trends' goal streak) simply not render for that data, never throw or show `NaN`/`undefined`. Covered in Tasks 3 and 9, re-verified in Task 8.
- HTPA's `htpa_training_v1` key being absent or malformed (HTPA never opened on this phone) must make the Trends weight overlay silently omit itself — never an error, never a broken chart. Covered in Task 3, re-verified in Task 8.

---

## Task 1: Project scaffold

**Files:**
- Modify: `index.html` (replace hello-world placeholder content)
- Modify: `manifest.json` (replace hello-world name/short_name; **keep** the existing `"id": "/HEPA/"` field)
- Modify: `service-worker.js` (replace with a dev-mode placeholder; finalized in Task 10)
- Create: `server.js`
- Create: `css/styles.css` (base reset + generic input/button/empty-hint styles only; component-specific CSS appended in later tasks)
- Icons: `icons/icon-192.png` and `icons/icon-512.png` already exist from the hello-world pipeline test — no action needed.

**Interfaces:**
- Produces: `#app` root `<div>` in `index.html` that `js/app.js` (Task 10) renders into.

- [ ] **Step 1: Replace `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>HEPA Nutrition Tracker</title>
<link rel="manifest" href="manifest.json" />
<meta name="theme-color" content="#1a1a2e" />
<link rel="icon" href="icons/icon-192.png" />
<link rel="stylesheet" href="css/styles.css" />
</head>
<body>
  <div id="app"></div>
  <script type="module" src="js/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace `manifest.json`** (keep the existing `id`; only `name`/`short_name` change from the hello-world version)

```json
{
  "id": "/HEPA/",
  "name": "HEPA Nutrition Tracker",
  "short_name": "HEPA",
  "start_url": "./index.html",
  "scope": "./",
  "display": "standalone",
  "background_color": "#1a1a2e",
  "theme_color": "#1a1a2e",
  "orientation": "portrait",
  "icons": [
    {
      "src": "icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

- [ ] **Step 3: Replace `service-worker.js` with a dev-mode placeholder** (final asset list added in Task 10; this version just keeps the app installable while building)

```js
const CACHE_NAME = 'hepa-dev';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', () => {
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
```

- [ ] **Step 4: Create `server.js`** (same pattern as HNSA/HTPA)

```js
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = 8000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/manifest+json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer((req, res) => {
  let reqPath = decodeURIComponent(req.url.split('?')[0]);
  if (reqPath === '/') reqPath = '/index.html';
  const filePath = path.join(ROOT, reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

- [ ] **Step 5: Create `css/styles.css`**

```css
:root {
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: #1a1a2e;
  color: #f5f5f7;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  height: 100%;
}
#app {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
input, select, button {
  font-size: 1rem;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid #44446a;
  background: #22223b;
  color: #f5f5f7;
}
button {
  cursor: pointer;
  background: #2d2d44;
}
button.save-btn, button.active {
  background: #4f6df5;
  border-color: #4f6df5;
}
h2 { font-size: 1.2rem; margin: 12px 0 8px; }
.empty-hint { color: #a0a0b0; padding: 16px; text-align: center; }
```

- [ ] **Step 6: Create an empty `js/app.js` so the page doesn't 404 on the module script, and verify the scaffold loads**

```js
document.getElementById('app').textContent = 'HEPA – scaffold loading.';
```

Start the server:

```bash
cd "C:/Users/micha/desktop/HEPA" && node server.js
```

In a second terminal:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/index.html
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/manifest.json
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/icons/icon-192.png
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:8000/js/app.js
```

Expected: all four return `HTTP 200`. Leave the server running in the background for the remaining tasks.

- [ ] **Step 7: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add index.html manifest.json service-worker.js server.js css/styles.css js/app.js
git commit -m "Replace hello-world placeholder with HEPA app scaffold"
git push
```

---

## Task 2: `js/store.js` — entries, targets, and nutrient derivation

**Files:**
- Create: `js/store.js`

**Interfaces:**
- Consumes: nothing (only `localStorage`, a browser global).
- Produces: the `Store` singleton with `Store.data` (`{ entries: [], targets: [] }`), `Store.addOffEntry(date, name, offId, base, quantity)`, `Store.addManualEntry(date, name, nutrients)`, `Store.updateEntryQuantity(id, quantity)`, `Store.updateManualEntry(id, name, nutrients)`, `Store.removeEntry(id)`, `Store.getEntriesForDate(date)` → entries sorted ascending by `loggedAt`, `Store.getEntryNutrients(entry)` → `{ calories, protein, carbs, fat, fiber, sugar }` (fiber/sugar may be `null`), `Store.setTargets(calories, protein, carbs, fat)` (each arg may be `null`), `Store.getCurrentTargets()` → latest target entry or `null`, `Store.getTargetForDate(date)` → the target active on that date or `null`. Task 3 appends more methods to this same `Store` object in this same file.

- [ ] **Step 1: Write `js/store.js`**

```js
const STORAGE_KEY = 'hepa_nutrition_v1';

function defaultData() {
  return { entries: [], targets: [] };
}

function genId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.targets)) return defaultData();
    return parsed;
  } catch (e) {
    return defaultData();
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) - data stays in memory only
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function quantityGrams(quantity) {
  return quantity.mode === 'grams'
    ? quantity.grams
    : quantity.servings * quantity.gramsPerServing;
}

// Pure function: derives the actual nutrients for an entry from its
// immutable base/quantity (OFF entries) or returns the stored totals as-is
// (manual entries). Never mutates, never caches — callers always get a
// fresh, correct value even right after `updateEntryQuantity`.
function deriveNutrients(entry) {
  if (entry.source === 'manual') {
    return entry.nutrients;
  }
  const factor = quantityGrams(entry.quantity) / 100;
  const b = entry.base;
  return {
    calories: round1(b.calories * factor),
    protein: round1(b.protein * factor),
    carbs: round1(b.carbs * factor),
    fat: round1(b.fat * factor),
    fiber: b.fiber == null ? null : round1(b.fiber * factor),
    sugar: b.sugar == null ? null : round1(b.sugar * factor)
  };
}

export const Store = {
  data: load(),

  addOffEntry(date, name, offId, base, quantity) {
    const entry = {
      id: genId('entry'),
      date,
      loggedAt: new Date().toISOString(),
      name,
      source: 'off',
      offId,
      base,
      quantity
    };
    this.data.entries.push(entry);
    save(this.data);
    return entry;
  },

  addManualEntry(date, name, nutrients) {
    const entry = {
      id: genId('entry'),
      date,
      loggedAt: new Date().toISOString(),
      name,
      source: 'manual',
      nutrients
    };
    this.data.entries.push(entry);
    save(this.data);
    return entry;
  },

  updateEntryQuantity(id, quantity) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.source !== 'off') return;
    entry.quantity = quantity;
    save(this.data);
  },

  updateManualEntry(id, name, nutrients) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.source !== 'manual') return;
    entry.name = name;
    entry.nutrients = nutrients;
    save(this.data);
  },

  removeEntry(id) {
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    save(this.data);
  },

  getEntriesForDate(date) {
    return this.data.entries
      .filter((e) => e.date === date)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  },

  getEntryNutrients(entry) {
    return deriveNutrients(entry);
  },

  setTargets(calories, protein, carbs, fat) {
    this.data.targets.push({ effectiveFrom: todayIso(), calories, protein, carbs, fat });
    this.data.targets.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    save(this.data);
  },

  getCurrentTargets() {
    if (this.data.targets.length === 0) return null;
    return this.data.targets[this.data.targets.length - 1];
  },

  getTargetForDate(date) {
    let active = null;
    for (const t of this.data.targets) {
      if (t.effectiveFrom <= date) active = t;
    }
    return active;
  }
};
```

- [ ] **Step 2: Manually verify in the browser console** (server from Task 1 still running; reload `http://localhost:8000/index.html` first)

```js
const { Store } = await import('./js/store.js');
Store.addOffEntry('2026-10-15', 'Banana', '0000031', { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2 }, { mode: 'grams', grams: 150 });
Store.getEntriesForDate('2026-10-15');
```

Expected: one entry with `source: 'off'`, `base.calories: 89`, `quantity: { mode: 'grams', grams: 150 }`.

```js
const [entry] = Store.getEntriesForDate('2026-10-15');
Store.getEntryNutrients(entry);
```

Expected: `{ calories: 133.5, protein: 1.7, carbs: 34.2, fat: 0.5, fiber: 3.9, sugar: 18.3 }` (150/100 = 1.5× scaling of the base values, each rounded to one decimal).

```js
Store.updateEntryQuantity(entry.id, { mode: 'grams', grams: 100 });
Store.getEntryNutrients(Store.getEntriesForDate('2026-10-15')[0]);
```

Expected: `{ calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2 }` — **Review Focus check**: nutrients recompute correctly from the updated quantity, with no stale 150g-scaled value surviving anywhere (there is no separate cached-nutrients field to go stale).

```js
Store.addManualEntry('2026-10-15', 'Protein shake', { calories: 150, protein: 30, carbs: 5, fat: 2, fiber: null, sugar: 2 });
Store.getEntryNutrients(Store.getEntriesForDate('2026-10-15')[1]);
```

Expected: `{ calories: 150, protein: 30, carbs: 5, fat: 2, fiber: null, sugar: 2 }` — manual entries return their stored totals unscaled.

```js
Store.getTargetForDate('2026-10-15');
```

Expected: `null` — **Review Focus check**: no target has been set yet, so lookups return `null` rather than throwing.

```js
Store.setTargets(2200, 150, 220, 70);
Store.getCurrentTargets();
Store.getTargetForDate('2026-10-15');
Store.getTargetForDate('2020-01-01');
```

Expected: `getCurrentTargets()` and today's `getTargetForDate` both return `{ effectiveFrom: '<today>', calories: 2200, protein: 150, carbs: 220, fat: 70 }`; `getTargetForDate('2020-01-01')` returns `null` (predates the only target entry).

**Reload the page** (persistence check), then in the console:

```js
const { Store } = await import('./js/store.js');
Store.data.entries.length;
Store.data.targets.length;
```

Expected: `2` and `1` — both survived the reload via `localStorage`.

Clean up test data once satisfied: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/store.js
git commit -m "Add store.js: entries/targets persistence and nutrient derivation"
git push
```

---

## Task 3: `js/store.js` — aggregates, goal streak, recent foods, HTPA weight read

**Files:**
- Modify: `js/store.js` (adds helpers and five more `Store` methods; full file shown below, replace the entire file)

**Interfaces:**
- Consumes: `deriveNutrients`, `Store.data` from Task 2 (same file, same module scope — no import needed).
- Produces (added to the same `Store` singleton): `Store.getDailyTotals()` → `[{ date, totals }]` ascending by date, one row per date with ≥1 entry; `Store.getWeeklyAverages()` → `[{ week: 'YYYY-Www', totals }]` ascending by week, each nutrient averaged across that week's days-with-entries; `Store.getGoalStreak(windowDays)` → `{ onTarget, counted }` counting only days in the last `windowDays` calendar days that have **both** a logged total and an applicable calorie target; `Store.getRecentFrequentFoods(limit)` → up to `limit` original entry objects, ranked by log frequency then recency, one per distinct food identity (OFF `offId`, or lowercase-trimmed `name` for manual); `Store.getHtpaBodyweightPoints()` → `[{ date, weight }]` ascending by date, or `[]` if HTPA's key is missing/malformed. Also exports the standalone helper `isoWeekKey(dateStr)` → `'YYYY-Www'`, reused directly by `js/trendsView.js` to align HTPA weight points onto weekly chart labels (avoids a second copy of the ISO-week algorithm). Consumed by `js/trendsView.js` (Task 8), `js/logView.js` (Task 6), `js/historyView.js` (Task 7).

- [ ] **Step 1: Replace `js/store.js` with the full file below** (Task 2's content plus the new helpers/methods)

```js
const STORAGE_KEY = 'hepa_nutrition_v1';
const HTPA_KEY = 'htpa_training_v1';

function defaultData() {
  return { entries: [], targets: [] };
}

function genId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.entries) || !Array.isArray(parsed.targets)) return defaultData();
    return parsed;
  } catch (e) {
    return defaultData();
  }
}

function save(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) - data stays in memory only
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}

function quantityGrams(quantity) {
  return quantity.mode === 'grams'
    ? quantity.grams
    : quantity.servings * quantity.gramsPerServing;
}

function deriveNutrients(entry) {
  if (entry.source === 'manual') {
    return entry.nutrients;
  }
  const factor = quantityGrams(entry.quantity) / 100;
  const b = entry.base;
  return {
    calories: round1(b.calories * factor),
    protein: round1(b.protein * factor),
    carbs: round1(b.carbs * factor),
    fat: round1(b.fat * factor),
    fiber: b.fiber == null ? null : round1(b.fiber * factor),
    sugar: b.sugar == null ? null : round1(b.sugar * factor)
  };
}

function sumNutrients(entries) {
  const totals = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };
  let hasFiber = false;
  let hasSugar = false;
  for (const e of entries) {
    const n = deriveNutrients(e);
    totals.calories += n.calories;
    totals.protein += n.protein;
    totals.carbs += n.carbs;
    totals.fat += n.fat;
    if (n.fiber != null) { totals.fiber += n.fiber; hasFiber = true; }
    if (n.sugar != null) { totals.sugar += n.sugar; hasSugar = true; }
  }
  return {
    calories: round1(totals.calories),
    protein: round1(totals.protein),
    carbs: round1(totals.carbs),
    fat: round1(totals.fat),
    fiber: hasFiber ? round1(totals.fiber) : null,
    sugar: hasSugar ? round1(totals.sugar) : null
  };
}

function averageNutrients(totalsList) {
  const n = totalsList.length;
  const sums = { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 };
  let fiberCount = 0;
  let sugarCount = 0;
  for (const t of totalsList) {
    sums.calories += t.calories;
    sums.protein += t.protein;
    sums.carbs += t.carbs;
    sums.fat += t.fat;
    if (t.fiber != null) { sums.fiber += t.fiber; fiberCount++; }
    if (t.sugar != null) { sums.sugar += t.sugar; sugarCount++; }
  }
  return {
    calories: round1(sums.calories / n),
    protein: round1(sums.protein / n),
    carbs: round1(sums.carbs / n),
    fat: round1(sums.fat / n),
    fiber: fiberCount ? round1(sums.fiber / fiberCount) : null,
    sugar: sugarCount ? round1(sums.sugar / sugarCount) : null
  };
}

// ISO-8601 week key, e.g. "2026-W42". Standard ISO week algorithm: shift to
// the Thursday of the same week (ISO weeks belong to the year containing
// their Thursday), then compare to that year's first Thursday.
export function isoWeekKey(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const weekNum = 1 + Math.round((d - firstThursday) / (7 * 86400000));
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

export const Store = {
  data: load(),

  addOffEntry(date, name, offId, base, quantity) {
    const entry = {
      id: genId('entry'),
      date,
      loggedAt: new Date().toISOString(),
      name,
      source: 'off',
      offId,
      base,
      quantity
    };
    this.data.entries.push(entry);
    save(this.data);
    return entry;
  },

  addManualEntry(date, name, nutrients) {
    const entry = {
      id: genId('entry'),
      date,
      loggedAt: new Date().toISOString(),
      name,
      source: 'manual',
      nutrients
    };
    this.data.entries.push(entry);
    save(this.data);
    return entry;
  },

  updateEntryQuantity(id, quantity) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.source !== 'off') return;
    entry.quantity = quantity;
    save(this.data);
  },

  updateManualEntry(id, name, nutrients) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.source !== 'manual') return;
    entry.name = name;
    entry.nutrients = nutrients;
    save(this.data);
  },

  removeEntry(id) {
    this.data.entries = this.data.entries.filter((e) => e.id !== id);
    save(this.data);
  },

  getEntriesForDate(date) {
    return this.data.entries
      .filter((e) => e.date === date)
      .sort((a, b) => a.loggedAt.localeCompare(b.loggedAt));
  },

  getEntryNutrients(entry) {
    return deriveNutrients(entry);
  },

  setTargets(calories, protein, carbs, fat) {
    this.data.targets.push({ effectiveFrom: todayIso(), calories, protein, carbs, fat });
    this.data.targets.sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    save(this.data);
  },

  getCurrentTargets() {
    if (this.data.targets.length === 0) return null;
    return this.data.targets[this.data.targets.length - 1];
  },

  getTargetForDate(date) {
    let active = null;
    for (const t of this.data.targets) {
      if (t.effectiveFrom <= date) active = t;
    }
    return active;
  },

  getDailyTotals() {
    const byDate = new Map();
    for (const e of this.data.entries) {
      if (!byDate.has(e.date)) byDate.set(e.date, []);
      byDate.get(e.date).push(e);
    }
    return [...byDate.entries()]
      .map(([date, entries]) => ({ date, totals: sumNutrients(entries) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },

  getWeeklyAverages() {
    const daily = this.getDailyTotals();
    const byWeek = new Map();
    for (const { date, totals } of daily) {
      const week = isoWeekKey(date);
      if (!byWeek.has(week)) byWeek.set(week, []);
      byWeek.get(week).push(totals);
    }
    return [...byWeek.entries()]
      .map(([week, totalsList]) => ({ week, totals: averageNutrients(totalsList) }))
      .sort((a, b) => a.week.localeCompare(b.week));
  },

  getGoalStreak(windowDays) {
    const dailyByDate = new Map(this.getDailyTotals().map((d) => [d.date, d.totals]));
    let onTarget = 0;
    let counted = 0;
    const today = new Date();
    for (let i = 0; i < windowDays; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      const target = this.getTargetForDate(dateStr);
      if (!target || target.calories == null) continue;
      const totals = dailyByDate.get(dateStr);
      if (!totals) continue;
      counted++;
      if (totals.calories <= target.calories) onTarget++;
    }
    return { onTarget, counted };
  },

  getRecentFrequentFoods(limit) {
    const counts = new Map();
    const mostRecent = new Map();
    for (const e of this.data.entries) {
      const key = e.source === 'off' ? `off:${e.offId}` : `manual:${e.name.trim().toLowerCase()}`;
      counts.set(key, (counts.get(key) || 0) + 1);
      const existing = mostRecent.get(key);
      if (!existing || e.loggedAt > existing.loggedAt) {
        mostRecent.set(key, e);
      }
    }
    return [...mostRecent.entries()]
      .map(([key, entry]) => ({ key, entry, count: counts.get(key), lastLoggedAt: entry.loggedAt }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return b.lastLoggedAt.localeCompare(a.lastLoggedAt);
      })
      .slice(0, limit)
      .map((g) => g.entry);
  },

  getHtpaBodyweightPoints() {
    try {
      const raw = localStorage.getItem(HTPA_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.bodyweight)) return [];
      return parsed.bodyweight
        .filter((b) => b && typeof b.date === 'string' && typeof b.weight === 'number')
        .map((b) => ({ date: b.date, weight: b.weight }))
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      return [];
    }
  }
};
```

- [ ] **Step 2: Manually verify in the browser console** (reload `http://localhost:8000/index.html` first; start from a clean slate with `localStorage.removeItem('hepa_nutrition_v1')` then reload)

```js
const { Store } = await import('./js/store.js');
Store.addManualEntry('2026-10-13', 'Oatmeal', { calories: 300, protein: 10, carbs: 50, fat: 5, fiber: 6, sugar: 2 });
Store.addManualEntry('2026-10-13', 'Chicken breast', { calories: 400, protein: 50, carbs: 0, fat: 10, fiber: null, sugar: null });
Store.addManualEntry('2026-10-14', 'Oatmeal', { calories: 300, protein: 10, carbs: 50, fat: 5, fiber: 6, sugar: 2 });
Store.getDailyTotals();
```

Expected: two rows, `2026-10-13` with `totals.calories: 700, totals.fiber: 6` (fiber summed only from the one entry that had it — Chicken's `null` fiber doesn't zero it out or exclude it from `hasFiber`), `2026-10-14` with `totals.calories: 300`. Sorted ascending by date.

```js
Store.getWeeklyAverages();
```

Expected: one row (both dates fall in the same ISO week) with `totals.calories` equal to the average of 700 and 300, i.e. `500`.

```js
Store.getRecentFrequentFoods(5);
```

Expected: `Oatmeal` first (logged twice, highest frequency), `Chicken breast` second — **Review Focus**: ranking is frequency-first, then recency as the tiebreaker.

```js
Store.getGoalStreak(30);
```

Expected: `{ onTarget: 0, counted: 0 }` — **Review Focus check**: no targets have been set, so no day is counted either way (not `NaN`, not an error).

```js
Store.setTargets(2200, null, null, null);
Store.getGoalStreak(30);
```

Expected: `{ onTarget: 0, counted: 0 }` still, because `effectiveFrom` is today and neither `2026-10-13` nor `2026-10-14` is in the last 30 days counting back from *today's actual date* unless you're running this on 2026-10-13/14 — note this check is date-relative; the important confirmation is that it runs without error and returns an object shaped `{ onTarget, counted }`.

```js
localStorage.removeItem('htpa_training_v1');
Store.getHtpaBodyweightPoints();
```

Expected: `[]` — **Review Focus check**: missing HTPA key returns an empty array, not an error.

```js
localStorage.setItem('htpa_training_v1', JSON.stringify({ sessions: [], bodyweight: [{ id: 'bw-1', date: '2026-10-10', weight: 78.5 }, { id: 'bw-2', date: '2026-10-05', weight: 79.2 }] }));
Store.getHtpaBodyweightPoints();
```

Expected: `[{ date: '2026-10-05', weight: 79.2 }, { date: '2026-10-10', weight: 78.5 }]` — ascending by date regardless of storage order.

```js
localStorage.setItem('htpa_training_v1', 'not valid json{{{');
Store.getHtpaBodyweightPoints();
```

Expected: `[]` — malformed JSON is caught, not thrown.

Clean up: `localStorage.removeItem('hepa_nutrition_v1'); localStorage.removeItem('htpa_training_v1');`, then reload.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/store.js
git commit -m "Extend store.js: daily/weekly aggregates, goal streak, recent foods, HTPA weight read"
git push
```

---

## Task 4: `js/foodSearch.js` — Open Food Facts lookup

**Files:**
- Create: `js/foodSearch.js`

**Interfaces:**
- Consumes: nothing (uses the global `fetch`).
- Produces: `async function searchFoods(query)` → resolves to an array of `{ offId, name, base: { calories, protein, carbs, fat, fiber, sugar }, servingGrams, servingLabel }` (`servingGrams`/`servingLabel` are `null` when OFF didn't report a serving size); rejects (throws) on a network failure or non-OK response — callers (Task 6) are responsible for catching this and showing their own offline/error message. Consumed by `js/logView.js` (Task 6).

- [ ] **Step 1: Write `js/foodSearch.js`**

```js
const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';

export async function searchFoods(query) {
  const url = `${SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=20`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Open Food Facts request failed: ${res.status}`);
  }
  const data = await res.json();
  const products = Array.isArray(data.products) ? data.products : [];
  return products
    .filter((p) => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] != null)
    .map(normalizeProduct);
}

function normalizeProduct(p) {
  const n = p.nutriments;
  const servingGrams = parseServingGrams(p.serving_size, p.serving_quantity);
  return {
    offId: p.code,
    name: p.product_name.trim(),
    base: {
      calories: numOr(n['energy-kcal_100g'], 0),
      protein: numOr(n['proteins_100g'], 0),
      carbs: numOr(n['carbohydrates_100g'], 0),
      fat: numOr(n['fat_100g'], 0),
      fiber: n['fiber_100g'] != null ? Number(n['fiber_100g']) : null,
      sugar: n['sugars_100g'] != null ? Number(n['sugars_100g']) : null
    },
    servingGrams,
    servingLabel: servingGrams != null ? (p.serving_size || `${servingGrams} g serving`) : null
  };
}

function numOr(value, fallback) {
  return value != null && !Number.isNaN(Number(value)) ? Number(value) : fallback;
}

function parseServingGrams(servingSize, servingQuantity) {
  if (servingQuantity != null && !Number.isNaN(Number(servingQuantity))) {
    return Number(servingQuantity);
  }
  if (typeof servingSize === 'string') {
    const match = servingSize.match(/([\d.]+)\s*g/i);
    if (match) return Number(match[1]);
  }
  return null;
}
```

- [ ] **Step 2: Manually verify in the browser console** (reload `http://localhost:8000/index.html`; requires internet access)

```js
const { searchFoods } = await import('./js/foodSearch.js');
const results = await searchFoods('banana');
results.length;
results[0];
```

Expected: `results.length` is a positive number (OFF has many banana products); `results[0]` has shape `{ offId: '<string>', name: '<string>', base: { calories: <number>, protein: <number>, carbs: <number>, fat: <number>, fiber: <number|null>, sugar: <number|null> }, servingGrams: <number|null>, servingLabel: <string|null> }`.

```js
try {
  await searchFoods('');
} catch (e) {
  console.log('caught:', e.message);
}
```

Run this and confirm it either resolves to an array (OFF treats an empty search as "all/none", both acceptable) or throws — either way nothing is unhandled; the point is `searchFoods` never silently hangs.

Test the offline path: DevTools → Network tab → throttling → "Offline", then:

```js
try {
  await searchFoods('banana');
} catch (e) {
  console.log('offline error caught:', e.message);
}
```

Expected: the `catch` block runs and logs an error — confirms a network failure surfaces as a normal rejected promise that `logView.js` (Task 6) can catch. Switch throttling back to "No throttling" afterward.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/foodSearch.js
git commit -m "Add foodSearch.js: Open Food Facts search wrapper"
git push
```

---

## Task 5: `js/chart.js` — hand-rolled inline-SVG multi-series line chart

**Files:**
- Create: `js/chart.js`
- Modify: `css/styles.css` (append chart styles)

**Interfaces:**
- Consumes: nothing.
- Produces: `renderLineChart(container, series)` where `series` is `[{ label: string, points: [{ x: string, y: number|null, tooltip: string }], axis?: 'secondary', color?: string }]`. `y: null` marks a gap at that x-slot (e.g. a day with no weight entry) — it's skipped when drawing but still occupies its index, so multiple series passed with equal-length `points` arrays stay aligned to the same shared x positions even when one has gaps the other doesn't. At least one series must have at least one non-null point — callers own their own empty-state message. A series with `axis: 'secondary'` is scaled against its own min/max (a second, independent y-scale) and drawn dashed, for overlaying values on a very different scale (e.g. bodyweight in kg next to calories). A legend renders automatically whenever `series.length > 1`. Consumed by `js/trendsView.js` (Task 8).

- [ ] **Step 1: Write `js/chart.js`**

```js
const WIDTH = 320;
const HEIGHT = 160;
const PADDING = 24;
const DEFAULT_COLORS = ['#4f6df5', '#ff9f43', '#2ed573', '#ff6b6b'];

export function renderLineChart(container, series) {
  container.innerHTML = '';

  const maxLen = Math.max(...series.map((s) => s.points.length));
  const xStep = maxLen > 1 ? (WIDTH - PADDING * 2) / (maxLen - 1) : 0;

  const primaryPoints = series.filter((s) => s.axis !== 'secondary').flatMap((s) => s.points);
  const secondaryPoints = series.filter((s) => s.axis === 'secondary').flatMap((s) => s.points);
  const primaryRange = valueRange(primaryPoints);
  const secondaryRange = secondaryPoints.length ? valueRange(secondaryPoints) : null;

  function scaleY(value, range) {
    if (range.span === 0) return HEIGHT / 2;
    return HEIGHT - PADDING - ((value - range.min) / range.span) * (HEIGHT - PADDING * 2);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('class', 'trend-chart-svg');

  series.forEach((s, idx) => {
    const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    const range = s.axis === 'secondary' ? secondaryRange : primaryRange;
    // Points may carry `y: null` to mark a gap at that x-slot (e.g. a day with
    // no weight entry) while still occupying its index — skipping null here
    // (rather than filtering the array beforehand) keeps every series aligned
    // to the same x position per shared label, even when series have gaps.
    const coords = [];
    s.points.forEach((p, i) => {
      if (p.y == null) return;
      coords.push({ x: PADDING + i * xStep, y: scaleY(p.y, range), tooltip: p.tooltip });
    });

    if (coords.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', coords.map((c) => `${c.x},${c.y}`).join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '2');
      if (s.axis === 'secondary') polyline.setAttribute('stroke-dasharray', '4,3');
      svg.appendChild(polyline);
    }

    coords.forEach((c) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', c.x);
      circle.setAttribute('cy', c.y);
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', color);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = c.tooltip;
      circle.appendChild(title);
      svg.appendChild(circle);
    });
  });

  container.appendChild(svg);

  if (series.length > 1) {
    const legend = document.createElement('div');
    legend.className = 'trend-chart-legend';
    series.forEach((s, idx) => {
      const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(s.label));
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  const labelSeries = series.find((s) => s.points.length > 0);
  if (labelSeries) {
    const labels = document.createElement('div');
    labels.className = 'trend-chart-labels';
    const first = document.createElement('span');
    first.textContent = labelSeries.points[0].x;
    const last = document.createElement('span');
    last.textContent = labelSeries.points[labelSeries.points.length - 1].x;
    labels.appendChild(first);
    labels.appendChild(last);
    container.appendChild(labels);
  }
}

function valueRange(points) {
  const values = points.map((p) => p.y).filter((y) => y != null);
  if (values.length === 0) return { min: 0, max: 1, span: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}
```

- [ ] **Step 2: Append chart styles to `css/styles.css`**

```css
.trend-chart-svg {
  width: 100%;
  max-width: 400px;
  height: auto;
  background: #22223b;
  border-radius: 8px;
}
.trend-chart-labels {
  display: flex;
  justify-content: space-between;
  font-size: 0.75rem;
  color: #a0a0b0;
  max-width: 400px;
  padding: 2px 4px;
}
.trend-chart-legend {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 0.75rem;
  color: #a0a0b0;
  max-width: 400px;
  padding: 4px;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 4px;
}
.legend-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
}
```

- [ ] **Step 3: Manually verify in the browser console** (reload `http://localhost:8000/index.html`)

```js
const { renderLineChart } = await import('./js/chart.js');
const container = document.createElement('div');
document.body.appendChild(container);
renderLineChart(container, [
  { label: 'Calories', points: [
    { x: '2026-10-13', y: 1800, tooltip: '1800 kcal' },
    { x: '2026-10-14', y: 2100, tooltip: '2100 kcal' },
    { x: '2026-10-15', y: 1950, tooltip: '1950 kcal' }
  ] }
]);
```

Expected, inspected visually: a single-line SVG chart appears, no legend (only one series), x-axis labels show `2026-10-13` on the left and `2026-10-15` on the right.

```js
renderLineChart(container, [
  { label: 'Protein', points: [{ x: '2026-10-13', y: 120, tooltip: '120g' }, { x: '2026-10-14', y: 140, tooltip: '140g' }] },
  { label: 'Carbs', points: [{ x: '2026-10-13', y: 200, tooltip: '200g' }, { x: '2026-10-14', y: 210, tooltip: '210g' }] },
  { label: 'Fat', points: [{ x: '2026-10-13', y: 60, tooltip: '60g' }, { x: '2026-10-14', y: 55, tooltip: '55g' }] }
]);
```

Expected: three colored lines plus a legend row listing Protein/Carbs/Fat with matching colored swatches.

```js
renderLineChart(container, [
  { label: 'Calories', points: [{ x: '2026-10-13', y: 1800, tooltip: '1800 kcal' }, { x: '2026-10-14', y: 2100, tooltip: '2100 kcal' }] },
  { label: 'Weight', axis: 'secondary', points: [{ x: '2026-10-13', y: 78.5, tooltip: '78.5 kg' }, { x: '2026-10-14', y: 78.3, tooltip: '78.3 kg' }] }
]);
```

Expected: two lines on clearly different visual scales (calories line roughly flat near the top/bottom of its own range, weight line dashed) — confirms the two series aren't forced onto one shared scale (which would flatten the weight line to near-invisible given it's ~78 vs ~2000).

```js
renderLineChart(container, [
  { label: 'Calories', points: [
    { x: '2026-10-13', y: 1800, tooltip: 'a' },
    { x: '2026-10-14', y: 2100, tooltip: 'b' },
    { x: '2026-10-15', y: 1950, tooltip: 'c' }
  ] },
  { label: 'Weight', axis: 'secondary', points: [
    { x: '2026-10-13', y: 78.5, tooltip: 'd' },
    { x: '2026-10-14', y: null, tooltip: '' },
    { x: '2026-10-15', y: 78.2, tooltip: 'e' }
  ] }
]);
```

Expected: the Weight line shows only two dots (skipping the middle, `null` day) while the Calories line still shows all three, and both lines' dots land under the correct one of the three x positions — confirms a `null` gap in one series doesn't shift that series' remaining points out of alignment with the other series' shared x-axis.

Also verify the single-point and flat-value cases don't crash:

```js
renderLineChart(container, [{ label: 'Calories', points: [{ x: '2026-10-13', y: 1800, tooltip: '1800 kcal' }] }]);
renderLineChart(container, [{ label: 'Calories', points: [{ x: '2026-10-13', y: 1800, tooltip: 'a' }, { x: '2026-10-14', y: 1800, tooltip: 'b' }] }]);
```

Expected: first call shows a single dot with no line; second shows two dots joined by a flat horizontal line, no divide-by-zero error in the console.

Remove the test container when done: `container.remove()`.

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/chart.js css/styles.css
git commit -m "Add chart.js: hand-rolled inline-SVG multi-series line chart"
git push
```

---

## Task 6: `js/logView.js` — Log tab

**Files:**
- Create: `js/logView.js`
- Modify: `css/styles.css` (append log-view styles)

**Interfaces:**
- Consumes: `Store.getRecentFrequentFoods(limit)`, `Store.addOffEntry`, `Store.addManualEntry` from `js/store.js` (Tasks 2–3); `searchFoods` from `js/foodSearch.js` (Task 4).
- Produces: `renderLogView(container)`. Consumed by `js/app.js` (Task 10).

- [ ] **Step 1: Write `js/logView.js`**

```js
import { Store } from './store.js';
import { searchFoods } from './foodSearch.js';

let searchDebounceTimer = null;

export function renderLogView(container) {
  renderBrowse(container);
}

function renderBrowse(container) {
  container.innerHTML = '';
  container.className = 'log-view';

  const title = document.createElement('h2');
  title.textContent = 'Log Food';
  container.appendChild(title);

  const recent = Store.getRecentFrequentFoods(6);
  const recentSection = document.createElement('div');
  recentSection.className = 'recent-foods';
  if (recent.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'Nothing logged yet — search below or add manually.';
    recentSection.appendChild(hint);
  } else {
    const heading = document.createElement('h3');
    heading.textContent = 'Recent';
    recentSection.appendChild(heading);
    const row = document.createElement('div');
    row.className = 'recent-foods-row';
    recent.forEach((entry) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'recent-chip';
      chip.textContent = entry.name;
      chip.addEventListener('click', () => renderPortionFromEntry(container, entry));
      row.appendChild(chip);
    });
    recentSection.appendChild(row);
  }
  container.appendChild(recentSection);

  const searchBox = document.createElement('input');
  searchBox.type = 'text';
  searchBox.placeholder = 'Search for a food…';
  searchBox.className = 'food-search-input';
  container.appendChild(searchBox);

  const resultsContainer = document.createElement('div');
  resultsContainer.className = 'search-results';
  container.appendChild(resultsContainer);

  searchBox.addEventListener('input', () => {
    clearTimeout(searchDebounceTimer);
    const query = searchBox.value.trim();
    if (query.length < 2) {
      resultsContainer.innerHTML = '';
      return;
    }
    searchDebounceTimer = setTimeout(() => runSearch(query, resultsContainer, container), 300);
  });

  const manualLink = document.createElement('button');
  manualLink.type = 'button';
  manualLink.className = 'manual-link';
  manualLink.textContent = "Can't find it? Add manually";
  manualLink.addEventListener('click', () => renderManualForm(container));
  container.appendChild(manualLink);
}

async function runSearch(query, resultsContainer, container) {
  resultsContainer.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'empty-hint';
  loading.textContent = 'Searching…';
  resultsContainer.appendChild(loading);

  try {
    const results = await searchFoods(query);
    resultsContainer.innerHTML = '';
    if (results.length === 0) {
      const none = document.createElement('p');
      none.className = 'empty-hint';
      none.textContent = 'No results — try a different search or add manually.';
      resultsContainer.appendChild(none);
      return;
    }
    results.forEach((food) => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'search-result-row';
      row.textContent = `${food.name} — ${Math.round(food.base.calories)} kcal/100g`;
      row.addEventListener('click', () => renderPortionFromSearch(container, food));
      resultsContainer.appendChild(row);
    });
  } catch (e) {
    resultsContainer.innerHTML = '';
    const err = document.createElement('p');
    err.className = 'empty-hint';
    err.textContent = "Couldn't reach the food database — check your connection, or add manually.";
    resultsContainer.appendChild(err);
  }
}

function renderPortionFromSearch(container, food) {
  renderPortion(container, {
    name: food.name,
    offId: food.offId,
    base: food.base,
    servingGrams: food.servingGrams,
    servingLabel: food.servingLabel,
    defaultQuantity: { mode: 'grams', grams: 100 }
  });
}

function renderPortionFromEntry(container, entry) {
  if (entry.source === 'manual') {
    renderManualForm(container, entry.name, entry.nutrients);
    return;
  }
  renderPortion(container, {
    name: entry.name,
    offId: entry.offId,
    base: entry.base,
    servingGrams: entry.quantity.mode === 'serving' ? entry.quantity.gramsPerServing : null,
    servingLabel: entry.quantity.mode === 'serving' ? entry.quantity.label : null,
    defaultQuantity: entry.quantity
  });
}

function renderPortion(container, food) {
  container.innerHTML = '';
  container.className = 'log-view';

  const title = document.createElement('h2');
  title.textContent = food.name;
  container.appendChild(title);

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = todayIso();
  container.appendChild(dateInput);

  const gramsInput = document.createElement('input');
  gramsInput.type = 'number';
  gramsInput.step = '1';
  gramsInput.placeholder = 'grams';
  gramsInput.value = food.defaultQuantity.mode === 'grams' ? food.defaultQuantity.grams : (food.servingGrams || 100);
  container.appendChild(gramsInput);

  let servingsInput = null;
  if (food.servingGrams) {
    const servingRow = document.createElement('div');
    servingRow.className = 'serving-row';
    const useServingBtn = document.createElement('button');
    useServingBtn.type = 'button';
    useServingBtn.textContent = `Use serving (${food.servingLabel || food.servingGrams + 'g'})`;
    useServingBtn.addEventListener('click', () => {
      servingsInput.style.display = 'inline-block';
      gramsInput.style.display = 'none';
      updatePreview();
    });
    servingRow.appendChild(useServingBtn);
    servingsInput = document.createElement('input');
    servingsInput.type = 'number';
    servingsInput.step = '0.5';
    servingsInput.value = food.defaultQuantity.mode === 'serving' ? food.defaultQuantity.servings : 1;
    servingRow.appendChild(servingsInput);
    container.appendChild(servingRow);

    // Re-logging a previously serving-based entry should reopen on the
    // serving input (with its last-used count), not silently fall back to
    // grams — otherwise the visible field wouldn't match the quantity the
    // user actually logged last time.
    if (food.defaultQuantity.mode === 'serving') {
      servingsInput.style.display = 'inline-block';
      gramsInput.style.display = 'none';
    } else {
      servingsInput.style.display = 'none';
    }
  }

  const preview = document.createElement('p');
  preview.className = 'nutrient-preview';
  container.appendChild(preview);

  function currentQuantity() {
    if (servingsInput && servingsInput.style.display !== 'none') {
      return { mode: 'serving', servings: Number(servingsInput.value) || 0, gramsPerServing: food.servingGrams, label: food.servingLabel };
    }
    return { mode: 'grams', grams: Number(gramsInput.value) || 0 };
  }

  function quantityGrams(q) {
    return q.mode === 'grams' ? q.grams : q.servings * q.gramsPerServing;
  }

  function updatePreview() {
    const factor = quantityGrams(currentQuantity()) / 100;
    const cal = Math.round(food.base.calories * factor);
    const p = Math.round(food.base.protein * factor);
    const c = Math.round(food.base.carbs * factor);
    const f = Math.round(food.base.fat * factor);
    preview.textContent = `${cal} kcal · P ${p}g · C ${c}g · F ${f}g`;
  }
  gramsInput.addEventListener('input', updatePreview);
  if (servingsInput) servingsInput.addEventListener('input', updatePreview);
  updatePreview();

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    Store.addOffEntry(dateInput.value, food.name, food.offId, food.base, currentQuantity());
    renderBrowse(container);
  });
  container.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderBrowse(container));
  container.appendChild(cancelBtn);
}

function renderManualForm(container, prefillName, prefillNutrients) {
  container.innerHTML = '';
  container.className = 'log-view';

  const title = document.createElement('h2');
  title.textContent = 'Add Manually';
  container.appendChild(title);

  const dateInput = document.createElement('input');
  dateInput.type = 'date';
  dateInput.value = todayIso();
  container.appendChild(dateInput);

  const nameInput = makeField('text', 'Food name', prefillName || '');
  const calInput = makeField('number', 'Calories', prefillNutrients ? prefillNutrients.calories : '');
  const proteinInput = makeField('number', 'Protein (g)', prefillNutrients ? prefillNutrients.protein : '');
  const carbsInput = makeField('number', 'Carbs (g)', prefillNutrients ? prefillNutrients.carbs : '');
  const fatInput = makeField('number', 'Fat (g)', prefillNutrients ? prefillNutrients.fat : '');
  const fiberInput = makeField('number', 'Fiber (g, optional)', prefillNutrients && prefillNutrients.fiber != null ? prefillNutrients.fiber : '');
  const sugarInput = makeField('number', 'Sugar (g, optional)', prefillNutrients && prefillNutrients.sugar != null ? prefillNutrients.sugar : '');

  [nameInput, calInput, proteinInput, carbsInput, fatInput, fiberInput, sugarInput].forEach((i) => container.appendChild(i));

  const errorMsg = document.createElement('p');
  errorMsg.className = 'log-error';
  errorMsg.textContent = 'Name and calories/protein/carbs/fat are required.';
  errorMsg.style.display = 'none';
  container.appendChild(errorMsg);

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name || calInput.value === '' || proteinInput.value === '' || carbsInput.value === '' || fatInput.value === '') {
      errorMsg.style.display = 'block';
      return;
    }
    const nutrients = {
      calories: Number(calInput.value),
      protein: Number(proteinInput.value),
      carbs: Number(carbsInput.value),
      fat: Number(fatInput.value),
      fiber: fiberInput.value === '' ? null : Number(fiberInput.value),
      sugar: sugarInput.value === '' ? null : Number(sugarInput.value)
    };
    Store.addManualEntry(dateInput.value, name, nutrients);
    renderBrowse(container);
  });
  container.appendChild(saveBtn);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderBrowse(container));
  container.appendChild(cancelBtn);
}

function makeField(type, placeholder, value) {
  const input = document.createElement('input');
  input.type = type;
  input.placeholder = placeholder;
  if (type === 'number') input.step = 'any';
  input.value = value;
  return input;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Append log-view styles to `css/styles.css`**

```css
.log-view, .history-view, .trends-view, .settings-view {
  padding: 12px;
  flex: 1;
}
.recent-foods-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}
.recent-chip {
  border-radius: 999px;
  padding: 6px 14px;
  font-size: 0.85rem;
}
.food-search-input {
  width: 100%;
  margin-bottom: 8px;
}
.search-result-row {
  display: block;
  width: 100%;
  text-align: left;
  margin-bottom: 6px;
}
.manual-link {
  background: none;
  border: none;
  color: #a0a0b0;
  text-decoration: underline;
  margin-top: 12px;
}
.serving-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 8px 0;
}
.nutrient-preview {
  color: #a0a0b0;
  margin: 8px 0;
}
.log-error {
  color: #ff6b6b;
  font-size: 0.85rem;
}
```

- [ ] **Step 3: Manually verify in the browser** (reload `http://localhost:8000/index.html`, console; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate)

```js
const container = document.createElement('div');
document.body.appendChild(container);
const { renderLogView } = await import('./js/logView.js');
renderLogView(container);
```

Expected: "Nothing logged yet…" empty hint (**Review Focus**: empty state), a search box, and the "Can't find it? Add manually" link.

1. Type `banana` in the search box, wait ~300ms → "Searching…" then a list of results appears.
2. Click a result → portion entry screen with a `grams` input defaulted to `100` and a live nutrient preview. Change grams to `150`, confirm the preview numbers scale up proportionally. Click Save → returns to the browse screen, and the "Recent" section now shows that food as a chip (**Review Focus** carried forward: confirms `getRecentFrequentFoods` picks up the new entry immediately).
3. Click the new "Recent" chip → portion screen pre-filled with the same food and the last-used quantity (150g). Click Cancel → back to browse, nothing new logged (`Store.data.entries.length` unchanged — check via `(await import('./js/store.js')).Store.data.entries.length`).
4. Click "Can't find it? Add manually", leave every field empty, click Save → red error message appears, no entry added.
5. Fill in Name `Protein bar`, Calories `200`, Protein `20`, Carbs `15`, Fat `6`, leave Fiber/Sugar blank, click Save → returns to browse; confirm via console: `(await import('./js/store.js')).Store.getEntriesForDate(new Date().toISOString().slice(0,10))` shows both entries, the manual one with `fiber: null, sugar: null`.
6. Test the offline path: DevTools → Network → throttling → "Offline", type a new search query → after the debounce, the "couldn't reach the food database" message appears instead of a hang or a thrown error, and the manual-entry link still works (**Review Focus**: search failure never blocks logging). Switch throttling back afterward.

Clean up: `localStorage.removeItem('hepa_nutrition_v1'); container.remove();`

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/logView.js css/styles.css
git commit -m "Add logView.js: search, quick-add, manual entry, portion entry"
git push
```

---

## Task 7: `js/historyView.js` — History tab

**Files:**
- Create: `js/historyView.js`
- Modify: `css/styles.css` (append history-view styles)

**Interfaces:**
- Consumes: `Store.getDailyTotals`, `Store.getEntriesForDate`, `Store.getEntryNutrients`, `Store.updateEntryQuantity`, `Store.updateManualEntry`, `Store.removeEntry` from `js/store.js` (Tasks 2–3).
- Produces: `renderHistoryView(container)`. Consumed by `js/app.js` (Task 10).

- [ ] **Step 1: Write `js/historyView.js`**

```js
import { Store } from './store.js';

export function renderHistoryView(container) {
  container.innerHTML = '';
  container.className = 'history-view';

  const title = document.createElement('h2');
  title.textContent = 'History';
  container.appendChild(title);

  const daily = Store.getDailyTotals().slice().reverse();
  if (daily.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'No food logged yet — add some in Log.';
    container.appendChild(hint);
    return;
  }

  daily.forEach(({ date, totals }) => {
    const dayBlock = document.createElement('div');
    dayBlock.className = 'day-block';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'day-header';
    header.textContent = `${date} — ${Math.round(totals.calories)} kcal`;
    dayBlock.appendChild(header);

    const entriesContainer = document.createElement('div');
    entriesContainer.className = 'day-entries';
    entriesContainer.style.display = 'none';
    dayBlock.appendChild(entriesContainer);

    let expanded = false;
    header.addEventListener('click', () => {
      expanded = !expanded;
      entriesContainer.style.display = expanded ? 'block' : 'none';
      if (expanded) renderDayEntries(entriesContainer, date, container);
    });

    container.appendChild(dayBlock);
  });
}

function renderDayEntries(entriesContainer, date, rootContainer) {
  entriesContainer.innerHTML = '';
  const entries = Store.getEntriesForDate(date);
  entries.forEach((entry) => {
    const row = document.createElement('div');
    row.className = 'entry-row';

    const nutrients = Store.getEntryNutrients(entry);
    const label = document.createElement('span');
    label.textContent = `${entry.name} — ${Math.round(nutrients.calories)} kcal`;
    row.appendChild(label);

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => renderEditForm(entriesContainer, entry, rootContainer));
    row.appendChild(editBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      Store.removeEntry(entry.id);
      renderHistoryView(rootContainer);
    });
    row.appendChild(deleteBtn);

    entriesContainer.appendChild(row);
  });
}

function renderEditForm(entriesContainer, entry, rootContainer) {
  entriesContainer.innerHTML = '';

  if (entry.source === 'off') {
    const gramsInput = document.createElement('input');
    gramsInput.type = 'number';
    gramsInput.value = entry.quantity.mode === 'grams'
      ? entry.quantity.grams
      : entry.quantity.servings * entry.quantity.gramsPerServing;
    entriesContainer.appendChild(gramsInput);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      Store.updateEntryQuantity(entry.id, { mode: 'grams', grams: Number(gramsInput.value) || 0 });
      renderHistoryView(rootContainer);
    });
    entriesContainer.appendChild(saveBtn);
  } else {
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = entry.name;
    const calInput = document.createElement('input');
    calInput.type = 'number';
    calInput.value = entry.nutrients.calories;
    const proteinInput = document.createElement('input');
    proteinInput.type = 'number';
    proteinInput.value = entry.nutrients.protein;
    const carbsInput = document.createElement('input');
    carbsInput.type = 'number';
    carbsInput.value = entry.nutrients.carbs;
    const fatInput = document.createElement('input');
    fatInput.type = 'number';
    fatInput.value = entry.nutrients.fat;
    [nameInput, calInput, proteinInput, carbsInput, fatInput].forEach((i) => entriesContainer.appendChild(i));

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      Store.updateManualEntry(entry.id, nameInput.value.trim() || entry.name, {
        calories: Number(calInput.value),
        protein: Number(proteinInput.value),
        carbs: Number(carbsInput.value),
        fat: Number(fatInput.value),
        fiber: entry.nutrients.fiber,
        sugar: entry.nutrients.sugar
      });
      renderHistoryView(rootContainer);
    });
    entriesContainer.appendChild(saveBtn);
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => renderHistoryView(rootContainer));
  entriesContainer.appendChild(cancelBtn);
}
```

- [ ] **Step 2: Append history-view styles to `css/styles.css`**

```css
.day-block {
  margin-bottom: 8px;
}
.day-header {
  width: 100%;
  text-align: left;
  background: #22223b;
}
.day-entries {
  padding: 8px 4px;
}
.entry-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid #333358;
}
.entry-row span {
  flex: 1;
}
```

- [ ] **Step 3: Manually verify in the browser** (reload `http://localhost:8000/index.html`, console; keep the entries logged in Task 6's verification, or create fresh ones via `Store.addManualEntry`/`Store.addOffEntry`)

```js
const container = document.createElement('div');
document.body.appendChild(container);
const { renderHistoryView } = await import('./js/historyView.js');
renderHistoryView(container);
```

1. If `hepa_nutrition_v1` is empty, confirm the "No food logged yet" hint (**Review Focus**: empty state), then add a couple of entries via the console (`Store.addOffEntry(...)`/`Store.addManualEntry(...)` as in Task 2/3's verification) and re-run `renderHistoryView(container)`.
2. Confirm each day header shows a rounded total calorie count, most recent date first.
3. Click a day header → expands to show its entries with Edit/Delete buttons.
4. For an OFF entry, click Edit → a single grams input appears pre-filled with the current amount. Change it and Save → the view collapses back to the day list, re-expand the same day, confirm the entry's displayed calorie total changed accordingly (**Review Focus**: quantity edit recomputes nutrients everywhere, no stale value).
5. For a manual entry, click Edit → name/calories/protein/carbs/fat inputs appear pre-filled. Change calories, Save → confirm the day's total calorie count in the collapsed header updated too.
6. Click Delete on an entry → it disappears from the day's list and the day's total recalculates; if it was the day's only entry, the whole day block disappears.

Clean up: `localStorage.removeItem('hepa_nutrition_v1'); container.remove();`

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/historyView.js css/styles.css
git commit -m "Add historyView.js: grouped-by-day list with edit/delete"
git push
```

---

## Task 8: `js/trendsView.js` — Trends tab

**Files:**
- Create: `js/trendsView.js`
- Modify: `css/styles.css` (append trends-view styles)

**Interfaces:**
- Consumes: `Store.getDailyTotals`, `Store.getWeeklyAverages`, `Store.getGoalStreak`, `Store.getHtpaBodyweightPoints`, `isoWeekKey` from `js/store.js` (Tasks 2–3); `renderLineChart` from `js/chart.js` (Task 5).
- Produces: `renderTrendsView(container)`. Consumed by `js/app.js` (Task 10).

- [ ] **Step 1: Write `js/trendsView.js`**

```js
import { Store, isoWeekKey } from './store.js';
import { renderLineChart } from './chart.js';

export function renderTrendsView(container) {
  container.innerHTML = '';
  container.className = 'trends-view';

  const title = document.createElement('h2');
  title.textContent = 'Trends';
  container.appendChild(title);

  const daily = Store.getDailyTotals();
  if (daily.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'No trends yet — log some food in the Log tab first.';
    container.appendChild(hint);
    return;
  }

  let granularity = 'daily';

  const toggleRow = document.createElement('div');
  toggleRow.className = 'granularity-toggle';
  const dailyBtn = document.createElement('button');
  dailyBtn.type = 'button';
  dailyBtn.textContent = 'Daily';
  const weeklyBtn = document.createElement('button');
  weeklyBtn.type = 'button';
  weeklyBtn.textContent = 'Weekly avg';
  toggleRow.appendChild(dailyBtn);
  toggleRow.appendChild(weeklyBtn);
  container.appendChild(toggleRow);

  const caloriesHeading = document.createElement('h3');
  caloriesHeading.textContent = 'Calories';
  container.appendChild(caloriesHeading);
  const caloriesChartContainer = document.createElement('div');
  container.appendChild(caloriesChartContainer);

  const macrosHeading = document.createElement('h3');
  macrosHeading.textContent = 'Macros';
  container.appendChild(macrosHeading);
  const macrosChartContainer = document.createElement('div');
  container.appendChild(macrosChartContainer);

  const streakContainer = document.createElement('div');
  container.appendChild(streakContainer);

  function updateButtons() {
    dailyBtn.className = granularity === 'daily' ? 'active' : '';
    weeklyBtn.className = granularity === 'weekly' ? 'active' : '';
  }

  function renderCharts() {
    updateButtons();

    let labels;
    let totalsList;
    if (granularity === 'daily') {
      labels = daily.map((d) => d.date);
      totalsList = daily.map((d) => d.totals);
    } else {
      const weekly = Store.getWeeklyAverages();
      labels = weekly.map((w) => w.week);
      totalsList = weekly.map((w) => w.totals);
    }

    const weightPoints = Store.getHtpaBodyweightPoints();
    const weightAligned = alignWeightToLabels(weightPoints, labels, granularity);

    const calorieSeriesList = [
      {
        label: 'Calories',
        points: labels.map((l, i) => ({
          x: l,
          y: totalsList[i].calories,
          tooltip: `${Math.round(totalsList[i].calories)} kcal`
        }))
      }
    ];
    if (weightAligned.some((v) => v != null)) {
      calorieSeriesList.push({
        label: 'Weight',
        axis: 'secondary',
        points: labels.map((l, i) => ({
          x: l,
          y: weightAligned[i],
          tooltip: weightAligned[i] != null ? `${weightAligned[i]} kg` : ''
        }))
      });
    }
    renderLineChart(caloriesChartContainer, calorieSeriesList);

    renderLineChart(macrosChartContainer, [
      { label: 'Protein', points: labels.map((l, i) => ({ x: l, y: totalsList[i].protein, tooltip: `${Math.round(totalsList[i].protein)}g` })) },
      { label: 'Carbs', points: labels.map((l, i) => ({ x: l, y: totalsList[i].carbs, tooltip: `${Math.round(totalsList[i].carbs)}g` })) },
      { label: 'Fat', points: labels.map((l, i) => ({ x: l, y: totalsList[i].fat, tooltip: `${Math.round(totalsList[i].fat)}g` })) }
    ]);

    streakContainer.innerHTML = '';
    const streak = Store.getGoalStreak(30);
    if (streak.counted > 0) {
      const streakText = document.createElement('p');
      streakText.className = 'goal-streak';
      streakText.textContent = `On target ${streak.onTarget} of the last ${streak.counted} logged days (last 30 days).`;
      streakContainer.appendChild(streakText);
    }
  }

  dailyBtn.addEventListener('click', () => { granularity = 'daily'; renderCharts(); });
  weeklyBtn.addEventListener('click', () => { granularity = 'weekly'; renderCharts(); });

  renderCharts();
}

function alignWeightToLabels(weightPoints, labels, granularity) {
  if (granularity === 'daily') {
    const byDate = new Map(weightPoints.map((p) => [p.date, p.weight]));
    return labels.map((d) => (byDate.has(d) ? byDate.get(d) : null));
  }
  const byWeek = new Map();
  weightPoints.forEach((p) => {
    const week = isoWeekKey(p.date);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(p.weight);
  });
  return labels.map((w) => {
    const vals = byWeek.get(w);
    if (!vals || vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  });
}
```

- [ ] **Step 2: Append trends-view styles to `css/styles.css`**

```css
.granularity-toggle {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.goal-streak {
  color: #a0a0b0;
  margin-top: 8px;
}
h3 {
  font-size: 1rem;
  margin: 16px 0 8px;
  color: #a0a0b0;
}
```

- [ ] **Step 3: Manually verify in the browser** (reload `http://localhost:8000/index.html`, console; `localStorage.removeItem('hepa_nutrition_v1'); localStorage.removeItem('htpa_training_v1');` first for a clean slate)

```js
const container = document.createElement('div');
document.body.appendChild(container);
const { renderTrendsView } = await import('./js/trendsView.js');
renderTrendsView(container);
```

Expected: "No trends yet…" empty hint (**Review Focus**: empty state).

```js
const { Store } = await import('./js/store.js');
Store.addManualEntry('2026-10-10', 'Day 1', { calories: 1900, protein: 140, carbs: 200, fat: 60, fiber: null, sugar: null });
Store.addManualEntry('2026-10-11', 'Day 2', { calories: 2300, protein: 150, carbs: 230, fat: 80, fiber: null, sugar: null });
Store.addManualEntry('2026-10-12', 'Day 3', { calories: 2000, protein: 145, carbs: 210, fat: 65, fiber: null, sugar: null });
renderTrendsView(container);
```

1. Confirm a Calories chart (one line, no legend) and a Macros chart (three lines, legend with Protein/Carbs/Fat) both render. No "On target…" line yet (**Review Focus**: no targets set → goal UI doesn't render).
2. Click "Weekly avg" → both charts re-render with fewer/aggregated points (all three dates likely fall in one ISO week, so expect a single averaged point per chart); click "Daily" → back to three points per chart.

```js
Store.setTargets(2000, null, null, null);
renderTrendsView(container);
```

3. Confirm an "On target N of the last M logged days" line now appears beneath the macros chart, with `M` equal to however many of the three logged dates fall within the last 30 calendar days from *today* (date-relative — if you're running this well after 2026-10-12, `M` may be `0`, which is expected and should simply omit the line again, not error).

```js
localStorage.setItem('htpa_training_v1', JSON.stringify({ sessions: [], bodyweight: [
  { id: 'bw-1', date: '2026-10-10', weight: 79.0 },
  { id: 'bw-2', date: '2026-10-12', weight: 78.6 }
] }));
renderTrendsView(container);
```

4. Confirm the Calories chart now also shows a dashed "Weight" line and a legend (Calories/Weight), with a visible gap on `2026-10-11` (no weight logged that day) — **Review Focus** carried forward from Task 5: the gap doesn't shift `2026-10-12`'s weight point out of alignment with its calories point.

```js
localStorage.removeItem('htpa_training_v1');
renderTrendsView(container);
```

5. Confirm the Weight line disappears entirely and the Calories chart falls back to a single line with no legend, no error in the console (**Review Focus**: missing HTPA key → weight overlay silently omits itself).

Clean up: `localStorage.removeItem('hepa_nutrition_v1'); localStorage.removeItem('htpa_training_v1'); container.remove();`

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/trendsView.js css/styles.css
git commit -m "Add trendsView.js: calories/macros charts, weight overlay, goal streak"
git push
```

---

## Task 9: `js/settingsView.js` — Settings tab

**Files:**
- Create: `js/settingsView.js`
- Modify: `css/styles.css` (append settings-view styles)

**Interfaces:**
- Consumes: `Store.getCurrentTargets`, `Store.setTargets` from `js/store.js` (Task 2).
- Produces: `renderSettingsView(container)`. Consumed by `js/app.js` (Task 10).

- [ ] **Step 1: Write `js/settingsView.js`**

```js
import { Store } from './store.js';

export function renderSettingsView(container) {
  container.innerHTML = '';
  container.className = 'settings-view';

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  container.appendChild(title);

  const heading = document.createElement('h3');
  heading.textContent = 'Daily targets';
  container.appendChild(heading);

  const current = Store.getCurrentTargets();
  const currentText = document.createElement('p');
  currentText.className = 'current-target';
  if (current) {
    const parts = [];
    if (current.calories != null) parts.push(`${current.calories} kcal`);
    if (current.protein != null) parts.push(`P ${current.protein}g`);
    if (current.carbs != null) parts.push(`C ${current.carbs}g`);
    if (current.fat != null) parts.push(`F ${current.fat}g`);
    currentText.textContent = parts.length > 0 ? `Current target: ${parts.join(' · ')}` : 'No target values set.';
  } else {
    currentText.textContent = 'No target set yet.';
  }
  container.appendChild(currentText);

  const calInput = makeField('Calories (optional)', current ? current.calories : null);
  const proteinInput = makeField('Protein g (optional)', current ? current.protein : null);
  const carbsInput = makeField('Carbs g (optional)', current ? current.carbs : null);
  const fatInput = makeField('Fat g (optional)', current ? current.fat : null);
  [calInput, proteinInput, carbsInput, fatInput].forEach((i) => container.appendChild(i));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save targets';
  saveBtn.addEventListener('click', () => {
    Store.setTargets(
      calInput.value === '' ? null : Number(calInput.value),
      proteinInput.value === '' ? null : Number(proteinInput.value),
      carbsInput.value === '' ? null : Number(carbsInput.value),
      fatInput.value === '' ? null : Number(fatInput.value)
    );
    renderSettingsView(container);
  });
  container.appendChild(saveBtn);
}

function makeField(placeholder, value) {
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.placeholder = placeholder;
  input.value = value == null ? '' : value;
  return input;
}
```

- [ ] **Step 2: Append settings-view styles to `css/styles.css`**

```css
.current-target {
  color: #a0a0b0;
  margin-bottom: 12px;
}
```

- [ ] **Step 3: Manually verify in the browser** (reload `http://localhost:8000/index.html`, console; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate)

```js
const container = document.createElement('div');
document.body.appendChild(container);
const { renderSettingsView } = await import('./js/settingsView.js');
renderSettingsView(container);
```

Expected: "No target set yet." and four empty optional number fields (**Review Focus**: empty state).

1. Fill Calories `2200` and Protein `150`, leave Carbs/Fat blank, click "Save targets" → the view re-renders, now showing `Current target: 2200 kcal · P 150g` (carbs/fat omitted since they're `null`, not shown as `0`), and the Calories/Protein fields stay populated while Carbs/Fat stay blank.
2. Change Calories to `2000`, click "Save targets" again → confirm via console: `(await import('./js/store.js')).Store.data.targets.length` is `2` (an append, not an overwrite — **Review Focus**: targets is a changelog) and `Store.getCurrentTargets().calories` is `2000`.

Clean up: `localStorage.removeItem('hepa_nutrition_v1'); container.remove();`

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/settingsView.js css/styles.css
git commit -m "Add settingsView.js: optional calorie/macro target editor"
git push
```

---

## Task 10: `js/app.js` — tab navigation and integration

**Files:**
- Create: `js/app.js` (overwrites the Task 1 placeholder)
- Modify: `css/styles.css` (append tab-nav styles)

**Interfaces:**
- Consumes: `renderLogView` from `js/logView.js` (Task 6); `renderHistoryView` from `js/historyView.js` (Task 7); `renderTrendsView` from `js/trendsView.js` (Task 8); `renderSettingsView` from `js/settingsView.js` (Task 9).
- Produces: nothing consumed elsewhere — this is the top-level entry point registered from `index.html`.

- [ ] **Step 1: Write `js/app.js`**

```js
import { renderLogView } from './logView.js';
import { renderHistoryView } from './historyView.js';
import { renderTrendsView } from './trendsView.js';
import { renderSettingsView } from './settingsView.js';

const appRoot = document.getElementById('app');

const TABS = [
  { id: 'log', label: 'Log' },
  { id: 'history', label: 'History' },
  { id: 'trends', label: 'Trends' },
  { id: 'settings', label: 'Settings' }
];

let activeTab = 'log';

function render() {
  appRoot.innerHTML = '';

  const nav = document.createElement('nav');
  nav.className = 'tab-nav';
  TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.className = tab.id === activeTab ? 'active' : '';
    btn.addEventListener('click', () => {
      activeTab = tab.id;
      render();
    });
    nav.appendChild(btn);
  });
  appRoot.appendChild(nav);

  const viewContainer = document.createElement('div');
  viewContainer.className = 'view-container';
  appRoot.appendChild(viewContainer);

  if (activeTab === 'log') {
    renderLogView(viewContainer);
  } else if (activeTab === 'history') {
    renderHistoryView(viewContainer);
  } else if (activeTab === 'trends') {
    renderTrendsView(viewContainer);
  } else if (activeTab === 'settings') {
    renderSettingsView(viewContainer);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js');
  });
}

render();
```

- [ ] **Step 2: Append tab-nav styles to `css/styles.css`**

```css
.tab-nav {
  display: flex;
  background: #22223b;
  border-bottom: 1px solid #333358;
  overflow-x: auto;
}
.tab-nav button {
  flex: 1;
  background: none;
  border: none;
  border-radius: 0;
  padding: 12px 6px;
  font-size: 0.8rem;
  color: #a0a0b0;
  white-space: nowrap;
}
.tab-nav button.active {
  color: #f5f5f7;
  border-bottom: 2px solid #4f6df5;
  background: none;
}
.view-container {
  flex: 1;
  overflow-y: auto;
}
```

- [ ] **Step 3: Manually verify the full app end-to-end in the desktop browser** (reload `http://localhost:8000/index.html`; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate)

1. The app loads on the Log tab, "Nothing logged yet" hint, search box, manual-entry link.
2. Search "apple", click a result, confirm the portion-entry screen and live preview, click Save → returns to the Log browse screen, which now shows the apple as a "Recent" chip.
3. Click the History tab → the logged apple appears under today's date with a rounded calorie total.
4. Click the Trends tab → Calories and Macros charts render (single-point charts are fine — already verified not to crash in Task 5).
5. Click the Settings tab → set Calories `2200`, Protein `150`, Save → "Current target: 2200 kcal · P 150g" appears.
6. Click back to the Log tab → confirms it always opens fresh on the browse screen (search box + recent list), never stuck on a previous portion/manual-entry screen from before the tab switch (**Review Focus**-adjacent: `logView.js` owns its own internal step state entirely within its own render call, so a fresh `renderLogView(viewContainer)` on every tab switch always starts at browse).
7. Reload the page → the apple entry, and the `2200`/`150` targets, are all still there (persistence through `localStorage`).

Clean up test data once satisfied: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/app.js css/styles.css
git commit -m "Add app.js: tab navigation and view wiring"
git push
```

---

## Task 11: Finalize service worker, offline and phone verification

**Files:**
- Modify: `service-worker.js` (replace the Task 1 placeholder with the real caching list)

**Interfaces:**
- Consumes: nothing new — this is the final asset manifest for everything built in Tasks 1–10.

- [ ] **Step 1: Replace `service-worker.js` with the real cache-first implementation**

```js
const CACHE_NAME = 'hepa-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/foodSearch.js',
  './js/chart.js',
  './js/logView.js',
  './js/historyView.js',
  './js/trendsView.js',
  './js/settingsView.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
```

Note: Open Food Facts requests from `js/foodSearch.js` hit `world.openfoodfacts.org`, which is never in `ASSETS` — `caches.match` always misses for them and the handler falls straight through to `fetch(event.request)`, so search traffic is correctly never cached or blocked by this worker, with no special-casing needed.

- [ ] **Step 2: Verify the new service worker installs cleanly on desktop**

Reload `http://localhost:8000/index.html`. DevTools → Application → Service Workers: confirm a worker for `hepa-v1` is "activated and running" (unregister any leftover `hepa-dev` worker from Task 1 first, then reload).

In DevTools → Application → Cache Storage, confirm `hepa-v1` contains all 13 entries from `ASSETS`.

- [ ] **Step 3: Verify real offline behavior on desktop**

DevTools → Network tab → throttling dropdown → "Offline". Reload the page. Expected: the app still loads fully (nav, tabs, any saved data); Log's search shows the "couldn't reach the food database" message from Task 6 rather than hanging, while the recent/frequent list and manual-entry form remain fully usable — confirms the service worker serves the app shell from cache while the (expected, by-design) network-only search gracefully degrades. Switch throttling back to "No throttling" afterward.

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add service-worker.js
git commit -m "Finalize service worker with full offline asset cache list"
git push
```

- [ ] **Step 5: Install and test on the phone**

1. On the phone, same Wi-Fi as the PC, open Chrome and go to `http://<PC-LAN-IP>:8000` (find the PC's LAN IP the same way as for HNSA/HTPA: `Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object InterfaceAlias, NextHop` in PowerShell, then use the IP on that interface). Confirm `node server.js` from Task 1 is still running.
2. Confirm the app loads and behaves like the desktop verification in Task 10, Step 3.
3. Chrome menu → "Install app".
4. Open the installed app from the home screen icon, search and log a real food, then turn on airplane mode and reopen the app from the icon — it must still load and show the logged data; the search box should show the offline message rather than hanging.
5. Turn airplane mode back off.

---

## Task 12: Cache-busting deploy hook

**Files:**
- Create: `.githooks/pre-commit`

**Interfaces:**
- Consumes: the `CACHE_NAME` constant declared in `service-worker.js` (Task 11) — the hook rewrites its value, it does not call any JS module.
- Produces: nothing consumed by app code — this only changes repo/git behavior from here on.

- [ ] **Step 1: Create `.githooks/pre-commit`**

```sh
#!/bin/sh
# Auto-bump the service worker cache name whenever an app file changes,
# so GitHub Pages redeploys always invalidate the installed PWA's cache.

changed=$(git diff --cached --name-only --diff-filter=ACMR)

touches_app=false
for f in $changed; do
  case "$f" in
    service-worker.js|.githooks/*|docs/*) ;;
    *) touches_app=true ;;
  esac
done

if [ "$touches_app" = "true" ]; then
  version=$(date -u +%Y%m%d%H%M%S)
  sed -i.bak "s/const CACHE_NAME = '[^']*';/const CACHE_NAME = 'hepa-v$version';/" service-worker.js
  rm -f service-worker.js.bak
  git add service-worker.js
fi
```

- [ ] **Step 2: Make the hook executable and point git at the tracked hooks directory**

```bash
cd "C:/Users/micha/desktop/HEPA"
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks
```

`core.hooksPath` is a local repo setting (stored in `.git/config`, not versioned) — a fresh clone of this repo on another machine would need this same `git config` command run once before the hook takes effect there.

- [ ] **Step 3: Verify the hook fires and bumps the cache name**

```bash
cd "C:/Users/micha/desktop/HEPA"
grep "CACHE_NAME" service-worker.js
```

Note the current value (should still be `hepa-v1` from Task 11). Make a trivial, real change to an app file — add a trailing blank line to `css/styles.css` — then commit:

```bash
git add .githooks/pre-commit
echo "" >> css/styles.css
git add css/styles.css
git commit -m "Add pre-commit hook to auto-bump service worker cache name"
grep "CACHE_NAME" service-worker.js
```

Expected: the second `grep` shows a new value like `const CACHE_NAME = 'hepa-v20261015143022';` — different from `hepa-v1` — and:

```bash
git show --stat HEAD
```

Expected: `service-worker.js` is listed as changed in this same commit, even though it was never explicitly `git add`-ed in this step — confirming the hook staged it automatically.

- [ ] **Step 4: Verify the hook does *not* fire for doc-only or hook-only changes**

```bash
cd "C:/Users/micha/desktop/HEPA"
grep "CACHE_NAME" service-worker.js
echo "<!-- test -->" >> docs/superpowers/plans/2026-10-15-hepa-nutrition-tracker.md
git add docs/superpowers/plans/2026-10-15-hepa-nutrition-tracker.md
git commit -m "Test: doc-only change should not bump cache"
grep "CACHE_NAME" service-worker.js
```

Expected: both `grep` outputs are identical — a doc-only commit did not touch `service-worker.js`. Revert that test edit afterward:

```bash
git revert --no-edit HEAD
```

- [ ] **Step 5: Push**

```bash
git push
```

Confirm on GitHub (`https://github.com/michaelrib25-droid/HEPA/commits/main`) that the pre-commit-hook commit and its auto-bumped `service-worker.js` are both present. From now on, any future "commit and push an update" request exercises this same hook automatically — no manual `CACHE_NAME` editing needed, and the installed app on the phone picks up the change on its next open via Chrome's background service-worker check.
<!-- test -->
