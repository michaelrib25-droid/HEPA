# FDC Search + OFF Barcode Lookup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace HEPA's unreliable Open Food Facts text search with USDA FoodData Central (FDC) search, and add an independent OFF barcode-lookup path (camera-first, manual-entry fallback) for specific supermarket products.

**Architecture:** `js/foodSearch.js` is removed and replaced by three isolated, single-purpose network/camera modules — `js/fdcSearch.js` (FDC text search), `js/barcodeLookup.js` (OFF barcode-by-code lookup), and `js/barcodeScanner.js` (camera + `BarcodeDetector` handling, no network knowledge of its own). Both network modules share a new `js/httpRetry.js` helper for the retry-on-transient-5xx behavior already proven in the just-shipped OFF-search fix. `js/store.js` gains a third entry `source` value, `"fdc"`, structurally identical to the existing `"off"` shape (per-100g `base` + `quantity`, derived at read time) — the four places in `store.js`/`logView.js`/`historyView.js` that currently check `source === 'off'` literally are generalized to treat `'off'` and `'fdc'` alike, since the real distinction has always been "has `base`/`quantity` to scale" vs. `'manual'`'s absolute totals.

**Tech Stack:** Plain JavaScript (ES modules), no build step, no new npm dependencies. USDA FoodData Central public search API (free API key, embedded client-side — not a secret). Open Food Facts barcode-lookup API (keyless). Browser `BarcodeDetector` API (native, Chrome-only, confirmed supported on this project's target: Chrome on Android) + `getUserMedia` for camera access.

**Spec:** `docs/superpowers/specs/2026-10-16-fdc-search-barcode-scan-design.md`

## Global Constraints

- No build tools/frameworks — plain vanilla HTML/CSS/JS using native ES modules (inherited from the original project spec).
- `source` on a logged entry is now `"off"` | `"fdc"` | `"manual"`. Only `"manual"` stores absolute `nutrients`; `"off"` and `"fdc"` both store per-100g `base` + `quantity`, scaled at read time by the existing `deriveNutrients()` in `store.js` (already generic — it branches on `=== 'manual'`, not on a specific non-manual source, so it needs no code change).
- The FDC `API_KEY` is a free, rate-limited identifier (not a secret) hardcoded as a constant in `js/fdcSearch.js`, same pattern as the URL constants already in the codebase — no settings-UI storage.
- No backend/proxy component — this was specifically ruled out in the design spec as undermining the whole reason a backend-less PWA works for this project.
- Barcode camera scanning targets Chrome on Android only (this project's one device) — no cross-browser polyfill or fallback library; unsupported browsers get the always-present manual barcode-entry field instead.
- No automated test suite — the project explicitly rejects one as disproportionate for a single-user offline app (inherited constraint). Each task below is verified manually, in the browser console and/or the rendered UI, not with `assert`/test-runner code.
- `service-worker.js`'s `ASSETS` list must stay in sync with the actual module files on disk — it still lists `./js/foodSearch.js` today, which will 404 the service worker's install step the moment that file is deleted if `ASSETS` isn't updated in the same task (Task 8).

## Review Focus

- A barcode that OFF doesn't recognize (`status: 0`, still **HTTP 200** — confirmed live, this is not a 404) must show a distinct "not found, add manually" message, never the same generic "couldn't reach the database" message used for a real network/5xx failure. Covered in Task 3 (module-level) and Task 6 (UI-level, both paths rendered).
- FDC returning a result list with no `Foundation`/`SR Legacy`/`Survey (FNDDS)` entries at all (only `Branded`) must still render a full, correctly-shaped result list — the generic-first sort must never hide or crash on an all-branded list. Covered in Task 2.
- Re-logging a previously `source: "fdc"` entry from the Log tab's "Recent" chips (not a fresh search) must correctly carry its `fdcId` through to the quantity screen and save back as `source: "fdc"` again — not silently misroute into the `"off"` path (which would read `entry.offId`, `undefined` for an fdc entry) or crash. Covered end-to-end in Task 6.
- Editing an existing `source: "fdc"` entry's grams in the History tab must work identically to an `"off"` entry — today `historyView.js` checks `entry.source === 'off'` literally, which would misroute any `"fdc"` entry into the manual-editing branch (reading `entry.nutrients`, which doesn't exist on it) and break. Covered in Task 7.
- Camera permission denied (or no camera present) must fall straight through to the always-visible manual barcode-entry field with an inline explanation — never a dead-end blank screen. Covered in Task 5 (simulated) and re-verified in Task 6 (real UI).

---

## Task 1: `js/httpRetry.js` — shared retry helper

**Files:**
- Create: `js/httpRetry.js`
- Modify: `js/foodSearch.js:1-6` (remove the now-duplicated local retry constants/logic in a later task once callers move off it — no change yet in this task; `foodSearch.js` is still in use until Task 8)

**Interfaces:**
- Produces: `async function fetchWithRetry(url, { label, timeoutMs, maxAttempts, retryDelayMs } = {})` → resolves to a `Response` with `res.ok === true`; throws `Error('<label> failed: <status>')` on a non-retryable (4xx) or exhausted-retry (5xx after `maxAttempts`) response, or the underlying `fetch` rejection (offline/timeout via `AbortController`). Consumed by `js/fdcSearch.js` (Task 2) and `js/barcodeLookup.js` (Task 3).

- [ ] **Step 1: Write `js/httpRetry.js`**

```js
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 400;

// Both OFF's barcode endpoint and FDC's search endpoint have been observed
// returning fast, transient 5xx responses independent of the request itself
// (confirmed via repeated direct testing) — a couple of quick retries clears
// most of them without meaningfully delaying a genuine offline/timeout
// failure, which still fails after a single full timeout since retrying a
// hung connection rarely helps.
export async function fetchWithRetry(url, options = {}) {
  const {
    label = 'Request',
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS
  } = options;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    if (res.status < 500 || attempt === maxAttempts) {
      throw new Error(`${label} failed: ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
}
```

- [ ] **Step 2: Manually verify in the browser console** (server from the original plan's Task 1 still running; reload `http://localhost:8000/index.html` first — this module has no UI, so the only way to exercise it is to call it directly and temporarily stub `window.fetch`)

```js
const { fetchWithRetry } = await import('./js/httpRetry.js');
const origFetch = window.fetch;

// Case 1: two transient 503s then success — should retry and resolve.
let calls = 0;
window.fetch = async () => {
  calls++;
  return calls < 3 ? new Response('', { status: 503 }) : new Response('{}', { status: 200 });
};
const start = Date.now();
const res = await fetchWithRetry('https://example.test/', { label: 'Test' });
console.log('case 1 — calls:', calls, 'status:', res.status, 'elapsed ms:', Date.now() - start);
```

Expected: `calls: 3`, `status: 200`, elapsed at least ~800ms (two 400ms retry delays).

```js
// Case 2: a 404 — must NOT retry, must throw immediately.
calls = 0;
window.fetch = async () => { calls++; return new Response('', { status: 404 }); };
try {
  await fetchWithRetry('https://example.test/', { label: 'Test' });
  console.log('case 2 — FAILED: did not throw');
} catch (e) {
  console.log('case 2 — calls:', calls, 'error:', e.message);
}
```

Expected: `calls: 1`, `error: "Test failed: 404"`.

```js
// Case 3: persistent 503s — must exhaust retries (default maxAttempts=3) and throw.
calls = 0;
window.fetch = async () => { calls++; return new Response('', { status: 503 }); };
try {
  await fetchWithRetry('https://example.test/', { label: 'Test' });
  console.log('case 3 — FAILED: did not throw');
} catch (e) {
  console.log('case 3 — calls:', calls, 'error:', e.message);
}
window.fetch = origFetch;
```

Expected: `calls: 3`, `error: "Test failed: 503"`. Restore `window.fetch` afterward (last line above) so the rest of the app keeps working normally in this tab.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/httpRetry.js
git commit -m "Add shared httpRetry helper for FDC/OFF network modules"
git push
```

---

## Task 2: `js/fdcSearch.js` — USDA FoodData Central search

**Files:**
- Create: `js/fdcSearch.js`

**Interfaces:**
- Consumes: `fetchWithRetry` from `js/httpRetry.js` (Task 1).
- Produces: `async function searchFoods(query)` → resolves to an array of up to 8 `{ fdcId, name, dataType, base: { calories, protein, carbs, fat, fiber, sugar }, servingGrams: null, servingLabel: null }`, sorted so `dataType` values `Foundation`/`SR Legacy`/`Survey (FNDDS)` rank before `Branded`; rejects on network/5xx failure. Consumed by `js/logView.js` (Task 6).

- [ ] **Step 1: Get a free FDC API key**

Go to `https://api.data.gov/signup/`, sign up with an email (free, instant, no credit card, no approval wait), and copy the API key from the confirmation page/email. The public `DEMO_KEY` is shared globally at 30 requests/hour and will get exhausted immediately with real use — a registered key gets 1000/hour. Keep the key handy for Step 2.

- [ ] **Step 2: Write `js/fdcSearch.js`** (replace `YOUR_FDC_API_KEY` below with the real key from Step 1)

```js
import { fetchWithRetry } from './httpRetry.js';

const API_KEY = 'YOUR_FDC_API_KEY'; // from https://api.data.gov/signup/
const SEARCH_URL = 'https://api.nal.usda.gov/fdc/v1/foods/search';
const RESULT_LIMIT = 8;
const GENERIC_DATA_TYPES = ['Foundation', 'SR Legacy', 'Survey (FNDDS)'];

// USDA nutrient IDs are stable across dataTypes even when the matching
// nutrientName string isn't (e.g. "Total Sugars" vs. "Sugars, total") —
// matching on ID avoids both that drift and the duplicate "Energy" entry
// some items report in kJ (nutrientId 1062) alongside the kcal one (1008).
const NUTRIENT_ID_MAP = {
  1008: 'calories',
  1003: 'protein',
  1005: 'carbs',
  1004: 'fat',
  1079: 'fiber',
  2000: 'sugar'
};

export async function searchFoods(query) {
  const url = `${SEARCH_URL}?api_key=${API_KEY}&query=${encodeURIComponent(query)}&pageSize=${RESULT_LIMIT}`;
  const res = await fetchWithRetry(url, { label: 'FDC search' });
  const data = await res.json();
  const foods = Array.isArray(data.foods) ? data.foods : [];
  return foods
    .map(normalizeFood)
    .filter((f) => f !== null)
    .sort((a, b) => genericRank(a.dataType) - genericRank(b.dataType));
}

function genericRank(dataType) {
  const idx = GENERIC_DATA_TYPES.indexOf(dataType);
  return idx === -1 ? GENERIC_DATA_TYPES.length : idx;
}

function normalizeFood(f) {
  const n = extractNutrients(f.foodNutrients);
  if (n.calories == null) return null;
  return {
    fdcId: f.fdcId,
    name: f.description,
    dataType: f.dataType,
    base: {
      calories: n.calories,
      protein: n.protein ?? 0,
      carbs: n.carbs ?? 0,
      fat: n.fat ?? 0,
      fiber: n.fiber ?? null,
      sugar: n.sugar ?? null
    },
    servingGrams: null,
    servingLabel: null
  };
}

function extractNutrients(foodNutrients) {
  const result = {};
  for (const n of foodNutrients || []) {
    const key = NUTRIENT_ID_MAP[n.nutrientId];
    if (key && result[key] == null) {
      result[key] = n.value;
    }
  }
  return result;
}
```

- [ ] **Step 3: Manually verify in the browser console** (reload `http://localhost:8000/index.html` first; requires internet access and the real key from Step 1 in place)

```js
const { searchFoods } = await import('./js/fdcSearch.js');
const results = await searchFoods('banana');
results.length;
results[0];
results.map((r) => r.dataType);
```

Expected: `results.length` is a positive number (≤8); `results[0]` has shape `{ fdcId: <number>, name: <string>, dataType: <string>, base: { calories: <number>, protein: <number>, carbs: <number>, fat: <number>, fiber: <number|null>, sugar: <number|null> }, servingGrams: null, servingLabel: null }`; `results[0].dataType` is one of `'Foundation'`/`'SR Legacy'`/`'Survey (FNDDS)'` (the generic entries sort first) with any `'Branded'` entries appearing later in the array.

```js
// Review Focus: a query likely to have only Branded matches must still
// return a full, correctly-sorted (if all-same-rank) list, not break.
const brandedOnly = await searchFoods('kid vids educational entertainment');
brandedOnly.every((r) => typeof r.base.calories === 'number');
```

Expected: resolves without throwing; every result has a numeric `base.calories` (the sort comparator doesn't require a generic entry to exist — equal ranks just preserve relative order).

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/fdcSearch.js
git commit -m "Add fdcSearch.js: USDA FoodData Central search wrapper"
git push
```

---

## Task 3: `js/barcodeLookup.js` — OFF barcode-by-code lookup

**Files:**
- Create: `js/barcodeLookup.js`

**Interfaces:**
- Consumes: `fetchWithRetry` from `js/httpRetry.js` (Task 1).
- Produces: `async function lookupBarcode(barcode)` → resolves to `{ offId, name, base: { calories, protein, carbs, fat, fiber, sugar }, servingGrams, servingLabel }` on a found product with usable nutrition data, or `null` if OFF reports the barcode as not found (`status !== 1`) **or** the product has no `energy-kcal_100g` value; rejects on network/5xx failure. Consumed by `js/logView.js` (Task 6).

- [ ] **Step 1: Write `js/barcodeLookup.js`**

```js
import { fetchWithRetry } from './httpRetry.js';

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupBarcode(barcode) {
  const url = `${PRODUCT_URL}/${encodeURIComponent(barcode)}.json`;
  const res = await fetchWithRetry(url, { label: 'Barcode lookup' });
  const data = await res.json();
  // OFF returns HTTP 200 even for an unrecognized barcode — "not found" is
  // signaled by status !== 1 in the JSON body, never by the HTTP status.
  if (data.status !== 1 || !data.product || data.product.nutriments?.['energy-kcal_100g'] == null) {
    return null;
  }
  return normalizeProduct(data.product);
}

function normalizeProduct(p) {
  const n = p.nutriments;
  const servingGrams = parseServingGrams(p.serving_size, p.serving_quantity);
  return {
    offId: p.code,
    name: (p.product_name || 'Unknown product').trim(),
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

- [ ] **Step 2: Manually verify in the browser console** (reload `http://localhost:8000/index.html` first; requires internet access)

```js
const { lookupBarcode } = await import('./js/barcodeLookup.js');

const nutella = await lookupBarcode('3017620422003');
nutella.name;
nutella.base.calories;
```

Expected: `nutella.name` is `'Nutella'` (or similar OFF-listed name); `nutella.base.calories` is a positive number around 539.

```js
// Review Focus: an unrecognized barcode is HTTP 200 with status:0 — must
// resolve to null, not throw, and must be distinguishable from a real
// network failure by the caller (logView.js, Task 6).
const missing = await lookupBarcode('0000000000000');
missing;
```

Expected: `missing` is exactly `null` (not `undefined`, not a thrown error).

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/barcodeLookup.js
git commit -m "Add barcodeLookup.js: Open Food Facts barcode lookup wrapper"
git push
```

---

## Task 4: `js/store.js` — add `"fdc"` as a third entry source

**Files:**
- Modify: `js/store.js:128-142` (new `addFdcEntry` method, mirrors `addOffEntry`)
- Modify: `js/store.js:158-163` (`updateEntryQuantity` — generalize the off-only guard)
- Modify: `js/store.js:250-269` (`getRecentFrequentFoods` — generalize the per-source dedup key)

**Interfaces:**
- Consumes: nothing new.
- Produces: `Store.addFdcEntry(date, name, fdcId, base, quantity)` → same shape/behavior as `Store.addOffEntry` but with `source: 'fdc'` and an `fdcId` field instead of `offId`. `Store.updateEntryQuantity` and `Store.getRecentFrequentFoods` now handle `'fdc'` entries correctly alongside `'off'` and `'manual'`. Consumed by `js/logView.js` (Task 6).

- [ ] **Step 1: Add `addFdcEntry`, right after the existing `addOffEntry` method**

```js
  addFdcEntry(date, name, fdcId, base, quantity) {
    const entry = {
      id: genId('entry'),
      date,
      loggedAt: new Date().toISOString(),
      name,
      source: 'fdc',
      fdcId,
      base,
      quantity
    };
    this.data.entries.push(entry);
    save(this.data);
    return entry;
  },
```

- [ ] **Step 2: Generalize `updateEntryQuantity`** — change the guard from "only `'off'`" to "anything with a `quantity` field, i.e. not `'manual'`"

```js
  updateEntryQuantity(id, quantity) {
    const entry = this.data.entries.find((e) => e.id === id);
    if (!entry || entry.source === 'manual') return;
    entry.quantity = quantity;
    save(this.data);
  },
```

- [ ] **Step 3: Generalize `getRecentFrequentFoods`'s dedup key** — currently branches only `'off'` vs. everything-else-treated-as-manual; make it three-way

```js
  getRecentFrequentFoods(limit) {
    const counts = new Map();
    const mostRecent = new Map();
    for (const e of this.data.entries) {
      const key = e.source === 'manual'
        ? `manual:${e.name.trim().toLowerCase()}`
        : `${e.source}:${e.source === 'off' ? e.offId : e.fdcId}`;
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
```

- [ ] **Step 4: Manually verify in the browser console** (reload `http://localhost:8000/index.html`; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate)

```js
const { Store, todayIso } = await import('./js/store.js');

const fdcBase = { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2 };
const entry = Store.addFdcEntry(todayIso(), 'Banana, raw', 1105314, fdcBase, { mode: 'grams', grams: 150 });
entry.source; // 'fdc'

const n = Store.getEntryNutrients(entry);
n.calories; // 89 * 1.5 = 133.5

Store.updateEntryQuantity(entry.id, { mode: 'grams', grams: 200 });
Store.getEntryNutrients(Store.data.entries.find((e) => e.id === entry.id)).calories; // 89 * 2 = 178

Store.getRecentFrequentFoods(5); // includes this fdc entry
```

Expected: `entry.source === 'fdc'`; `n.calories === 133.5`; after the quantity update, recalculated calories `=== 178`; the fdc entry appears in `getRecentFrequentFoods`'s results without throwing.

Clean up: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 5: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/store.js
git commit -m "store.js: add fdc entry source alongside off and manual"
git push
```

---

## Task 5: `js/barcodeScanner.js` — camera + `BarcodeDetector` handling

**Files:**
- Create: `js/barcodeScanner.js`

**Interfaces:**
- Consumes: nothing (browser `BarcodeDetector`/`navigator.mediaDevices` APIs only).
- Produces: `isBarcodeDetectionSupported()` → `boolean`. `async function startScanning(videoEl, onDetected, onError)` → attaches a live camera stream to `videoEl` and repeatedly scans for a barcode; calls `onDetected(barcodeString)` exactly once on the first detection (and stops itself), or calls `onError(error)` if camera access fails; resolves to a `stop()` function the caller can call early (e.g. on Cancel) to release the camera. Consumed by `js/logView.js` (Task 6).

- [ ] **Step 1: Write `js/barcodeScanner.js`**

```js
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];

export function isBarcodeDetectionSupported() {
  return 'BarcodeDetector' in window;
}

export async function startScanning(videoEl, onDetected, onError) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  } catch (e) {
    onError(e);
    return () => {};
  }

  videoEl.srcObject = stream;
  await videoEl.play();

  const detector = new BarcodeDetector({ formats: BARCODE_FORMATS });
  let stopped = false;
  let rafId = null;

  function stop() {
    if (stopped) return;
    stopped = true;
    if (rafId != null) cancelAnimationFrame(rafId);
    stream.getTracks().forEach((t) => t.stop());
  }

  async function tick() {
    if (stopped) return;
    try {
      const barcodes = await detector.detect(videoEl);
      if (barcodes.length > 0) {
        stop();
        onDetected(barcodes[0].rawValue);
        return;
      }
    } catch (e) {
      // Transient per-frame detection errors are expected (e.g. a frame not
      // ready yet) — keep scanning rather than treating them as fatal.
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
  return stop;
}
```

- [ ] **Step 2: Manually verify feature detection and the permission-denied path in the browser console** (reload `http://localhost:8000/index.html`; desktop Chrome also supports `BarcodeDetector`, so this step works without a phone — full camera-to-detection testing happens on the phone in Task 6)

```js
const { isBarcodeDetectionSupported, startScanning } = await import('./js/barcodeScanner.js');
isBarcodeDetectionSupported();
```

Expected: `true` in desktop Chrome.

```js
// Review Focus: simulate a camera permission denial — must call onError and
// return a safe no-op stop(), never throw out of startScanning itself.
const origGetUserMedia = navigator.mediaDevices.getUserMedia;
navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Permission denied', 'NotAllowedError'); };

let errorSeen = null;
const video = document.createElement('video');
const stop = await startScanning(video, () => {}, (e) => { errorSeen = e; });
console.log('error seen:', errorSeen?.name);
stop(); // must not throw even though no stream was ever opened

navigator.mediaDevices.getUserMedia = origGetUserMedia;
```

Expected: `error seen: NotAllowedError`; calling `stop()` afterward does not throw.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/barcodeScanner.js
git commit -m "Add barcodeScanner.js: BarcodeDetector camera scanning"
git push
```

---

## Task 6: `js/logView.js` — rewire search, add barcode scan UI

**Files:**
- Modify: `js/logView.js` (full rewrite of the import and the food-result/portion-screen plumbing; the manual-entry form is untouched)
- Modify: `css/styles.css` (append scan-button/camera-view styles)

**Interfaces:**
- Consumes: `searchFoods` from `js/fdcSearch.js` (Task 2); `lookupBarcode` from `js/barcodeLookup.js` (Task 3); `isBarcodeDetectionSupported`, `startScanning` from `js/barcodeScanner.js` (Task 5); `Store.addFdcEntry` (Task 4) alongside the existing `Store.addOffEntry`/`Store.addManualEntry`/`Store.getRecentFrequentFoods`.
- Produces: `renderLogView(container)` (signature unchanged — still consumed by `js/app.js`).

- [ ] **Step 1: Rewrite `js/logView.js`**

```js
import { Store, todayIso } from './store.js';
import { searchFoods } from './fdcSearch.js';
import { lookupBarcode } from './barcodeLookup.js';
import { isBarcodeDetectionSupported, startScanning } from './barcodeScanner.js';

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

  const today = todayIso();
  const todayTotals = Store.getDailyTotals().find((d) => d.date === today)?.totals;
  const todayTarget = Store.getTargetForDate(today);
  const progress = document.createElement('p');
  progress.className = 'today-progress';
  if (todayTotals) {
    const cal = Math.round(todayTotals.calories);
    progress.textContent = todayTarget?.calories != null
      ? `Today: ${cal} / ${todayTarget.calories} kcal`
      : `Today: ${cal} kcal`;
  } else {
    progress.textContent = 'Nothing logged today yet.';
  }
  container.appendChild(progress);

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

  const scanBtn = document.createElement('button');
  scanBtn.type = 'button';
  scanBtn.className = 'scan-btn';
  scanBtn.textContent = '📷 Scan barcode';
  scanBtn.addEventListener('click', () => renderBarcodeScan(container));
  container.appendChild(scanBtn);

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

function renderBarcodeScan(container) {
  container.innerHTML = '';
  container.className = 'log-view';

  const title = document.createElement('h2');
  title.textContent = 'Scan Barcode';
  container.appendChild(title);

  const statusMsg = document.createElement('p');
  statusMsg.className = 'empty-hint';
  container.appendChild(statusMsg);

  let stopScanning = () => {};

  if (isBarcodeDetectionSupported()) {
    const video = document.createElement('video');
    video.className = 'barcode-video';
    video.setAttribute('playsinline', '');
    video.muted = true;
    container.appendChild(video);

    statusMsg.textContent = 'Point the camera at a barcode…';
    startScanning(
      video,
      // barcodeScanner.js already stops the camera internally before
      // calling onDetected, so no need to call stopScanning() here too.
      (barcode) => handleBarcode(container, barcode),
      () => { statusMsg.textContent = 'Camera unavailable — enter the barcode manually below.'; }
    ).then((stop) => { stopScanning = stop; });
  } else {
    statusMsg.textContent = "Camera scanning isn't supported on this browser — enter the barcode manually below.";
  }

  const manualRow = document.createElement('div');
  manualRow.className = 'serving-row';
  const manualInput = document.createElement('input');
  manualInput.type = 'text';
  manualInput.inputMode = 'numeric';
  manualInput.placeholder = 'Enter barcode manually';
  manualRow.appendChild(manualInput);
  const manualBtn = document.createElement('button');
  manualBtn.type = 'button';
  manualBtn.textContent = 'Look up';
  manualBtn.addEventListener('click', () => {
    const code = manualInput.value.trim();
    if (code) {
      stopScanning();
      handleBarcode(container, code);
    }
  });
  manualRow.appendChild(manualBtn);
  container.appendChild(manualRow);

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    stopScanning();
    renderBrowse(container);
  });
  container.appendChild(cancelBtn);
}

async function handleBarcode(container, barcode) {
  container.innerHTML = '';
  container.className = 'log-view';
  const loading = document.createElement('p');
  loading.className = 'empty-hint';
  loading.textContent = 'Looking up barcode…';
  container.appendChild(loading);

  try {
    const food = await lookupBarcode(barcode);
    if (!food) {
      renderBarcodeFallback(container, `No product found for barcode ${barcode} — add it manually instead.`);
      return;
    }
    renderPortionFromBarcode(container, food);
  } catch (e) {
    renderBarcodeFallback(container, "Couldn't reach the food database — check your connection, or add manually.");
  }
}

function renderBarcodeFallback(container, message) {
  container.innerHTML = '';
  container.className = 'log-view';

  const msg = document.createElement('p');
  msg.className = 'empty-hint';
  msg.textContent = message;
  container.appendChild(msg);

  const manualLink = document.createElement('button');
  manualLink.type = 'button';
  manualLink.className = 'manual-link';
  manualLink.textContent = 'Add manually';
  manualLink.addEventListener('click', () => renderManualForm(container));
  container.appendChild(manualLink);

  const backBtn = document.createElement('button');
  backBtn.type = 'button';
  backBtn.textContent = 'Back';
  backBtn.addEventListener('click', () => renderBrowse(container));
  container.appendChild(backBtn);
}

function renderPortionFromSearch(container, food) {
  renderPortion(container, {
    name: food.name,
    source: 'fdc',
    fdcId: food.fdcId,
    base: food.base,
    servingGrams: food.servingGrams,
    servingLabel: food.servingLabel,
    defaultQuantity: { mode: 'grams', grams: 100 }
  });
}

function renderPortionFromBarcode(container, food) {
  renderPortion(container, {
    name: food.name,
    source: 'off',
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
    source: entry.source,
    offId: entry.source === 'off' ? entry.offId : undefined,
    fdcId: entry.source === 'fdc' ? entry.fdcId : undefined,
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
    const quantity = currentQuantity();
    if (food.source === 'off') {
      Store.addOffEntry(dateInput.value, food.name, food.offId, food.base, quantity);
    } else {
      Store.addFdcEntry(dateInput.value, food.name, food.fdcId, food.base, quantity);
    }
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
```

- [ ] **Step 2: Append barcode UI styles to `css/styles.css`**

```css
.scan-btn {
  width: 100%;
  margin-bottom: 12px;
}
.barcode-video {
  width: 100%;
  max-width: 400px;
  border-radius: 8px;
  background: #000;
  margin-bottom: 8px;
  display: block;
}
```

- [ ] **Step 3: Manually verify in the browser** (reload `http://localhost:8000/index.html`; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate; requires internet access and the real FDC key from Task 2)

1. On the Log tab, type "banana" in the search box. Expected: a results list appears within ~1-2s, first result's `dataType` is generic (shown implicitly by a sensible-looking name like "Banana, raw" rather than a specific brand). Click it, set grams, Save. Expected: lands back on the Log tab, "Recent" now shows the saved food, today's progress line updates.
2. Click the "Recent" chip for that same food again (re-logging it). Expected: opens the quantity screen without error; Save again succeeds. This is the Review Focus case — an `fdc`-sourced entry round-tripping through `renderPortionFromEntry`.
3. Click "📷 Scan barcode". Expected (desktop, camera present): a camera permission prompt appears; on allow, a live video feed renders with "Point the camera at a barcode…"; the "Enter barcode manually" field is visible at the same time, not only after a failure.
4. Click "📷 Scan barcode" again and this time click **Block/Deny** on the permission prompt (Review Focus case — real-browser camera denial, not just the Task 5 simulation). Expected: the status message switches to "Camera unavailable — enter the barcode manually below." and the manual field + "Look up" button are present and usable — no blank screen, no stuck "Point the camera…" text.
5. In the allowed-camera screen from step 3, type `3017620422003` into the manual field and click "Look up" (don't bother pointing a real barcode at the camera on desktop — full camera-to-detection testing happens on the phone in step 7 below). Expected: "Looking up barcode…" then the quantity screen for "Nutella" (or OFF's listed name), `source: 'off'` under the hood. Save it.
6. Repeat "Scan barcode" → manual entry with `0000000000000`. Expected: "No product found for barcode 0000000000000 — add it manually instead." with working "Add manually" and "Back" buttons — not the generic connection-error message.
7. On the phone (installed PWA or `http://<LAN-IP>:8000/` in Chrome): repeat step 3 with a real product's barcode in front of the camera. Expected: the video feed auto-detects the barcode within a couple of seconds without tapping anything, and lands on the quantity screen for the real product.

Clean up: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 4: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/logView.js css/styles.css
git commit -m "logView.js: switch search to FDC, add barcode scan UI"
git push
```

---

## Task 7: `js/historyView.js` — generalize the quantity-edit branch

**Files:**
- Modify: `js/historyView.js:80` (the `entry.source === 'off'` check in `renderEditForm`)

**Interfaces:**
- Consumes: no new interfaces — same `Store` methods as before.
- Produces: no new exports — `renderEditForm`'s internal branch now also handles `'fdc'` entries.

- [ ] **Step 1: Change the branch condition**

```js
  if (entry.source !== 'manual') {
```

(replacing the existing `if (entry.source === 'off') {`; the branch body is unchanged — it already only reads `entry.quantity`, which both `'off'` and `'fdc'` entries have)

- [ ] **Step 2: Manually verify in the browser** (reload `http://localhost:8000/index.html`; `localStorage.removeItem('hepa_nutrition_v1')` first)

```js
const { Store, todayIso } = await import('./js/store.js');
Store.addFdcEntry(todayIso(), 'Banana, raw', 1105314, { calories: 89, protein: 1.1, carbs: 22.8, fat: 0.3, fiber: 2.6, sugar: 12.2 }, { mode: 'grams', grams: 150 });
```

Then in the UI: go to the History tab, expand today, click "Edit" on the Banana entry. Expected: shows the grams-editing form (a single "Grams" field + Save/Cancel), same as an off-sourced entry — not the manual name/calories/protein/carbs/fat form. Change the grams value and Save; expected: the day's total calories in the collapsed header updates accordingly.

Clean up: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 3: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add js/historyView.js
git commit -m "historyView.js: treat fdc entries like off entries when editing"
git push
```

---

## Task 8: Remove `js/foodSearch.js`, update service worker + docs, full end-to-end verification

**Files:**
- Delete: `js/foodSearch.js`
- Modify: `service-worker.js:2-17` (`ASSETS` list — remove `./js/foodSearch.js`, add the four new module paths)
- Modify: `CLAUDE.md` (spec pointer + food-search architecture description + data-model entry-shape bullet)

**Interfaces:**
- Consumes/Produces: nothing new — this task removes the now-unused module and brings the service worker's cache manifest and the project's own instructions file back in sync with reality.

- [ ] **Step 1: Delete `js/foodSearch.js`**

```bash
cd "C:/Users/micha/desktop/HEPA"
git rm js/foodSearch.js
```

- [ ] **Step 2: Update `service-worker.js`'s `ASSETS` list**

```js
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/app.js',
  './js/store.js',
  './js/httpRetry.js',
  './js/fdcSearch.js',
  './js/barcodeLookup.js',
  './js/barcodeScanner.js',
  './js/chart.js',
  './js/logView.js',
  './js/historyView.js',
  './js/trendsView.js',
  './js/settingsView.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
```

(only the `ASSETS` array changes — leave `CACHE_NAME` alone, the pre-commit hook rewrites it automatically on this commit since it touches app files other than `service-worker.js`/`.githooks/*`/`docs/*`)

- [ ] **Step 3: Update `CLAUDE.md`**

In the "What this is" section, change:

```
Primarily meant to surface long-term eating trends (daily/weekly patterns, goal
adherence, correlation with the sibling HTPA project's bodyweight log) — day-to-day
visibility matters but is secondary to trends/history. Single-user, no backend beyond
the public Open Food Facts API, no cloud sync of its own data. Vanilla JS, no framework,
no build step.

Full design spec: `docs/superpowers/specs/2026-10-15-hepa-nutrition-tracker-design.md`.
```

to:

```
Primarily meant to surface long-term eating trends (daily/weekly patterns, goal
adherence, correlation with the sibling HTPA project's bodyweight log) — day-to-day
visibility matters but is secondary to trends/history. Single-user, no backend beyond
public food-lookup APIs (USDA FoodData Central for text search, Open Food Facts for
barcode lookup), no cloud sync of its own data. Vanilla JS, no framework, no build step.

Full design spec: `docs/superpowers/specs/2026-10-15-hepa-nutrition-tracker-design.md`,
superseded in part by `docs/superpowers/specs/2026-10-16-fdc-search-barcode-scan-design.md`
(food search moved from Open Food Facts to USDA FDC; barcode lookup added).
```

In the "Architecture" section, change the paragraph starting "**The one architectural departure...**":

```
**The one architectural departure from HTPA/HNSA's fully-offline pattern:**
`foodSearch.js` makes live network calls to the Open Food Facts API during food search.
Nothing else in the app depends on network — OFF search failing (offline, timeout, no
results) must degrade to an inline message while the manual-entry fallback stays fully
usable. Don't let a network dependency leak into logging, history, or trends.
```

to:

```
**The one architectural departure from HTPA/HNSA's fully-offline pattern:**
`fdcSearch.js` (USDA FoodData Central text search), `barcodeLookup.js` (Open Food
Facts barcode-by-code lookup), and `barcodeScanner.js` (camera + `BarcodeDetector`)
make the only live network/camera calls in the app. Nothing else depends on network —
a search or barcode-lookup failure (offline, timeout, barcode not recognized) must
degrade to an inline message while the manual-entry fallback stays fully usable. Don't
let a network dependency leak into logging, history, or trends.
```

And in the data-model bullet list, change:

```
- Entries have two shapes depending on `source`:
```

to:

```
- Entries have three shapes depending on `source`:
```

and add, after the existing `source: "off"` sub-bullet:

```
  - `source: "fdc"` entries are structurally identical to `source: "off"` ones — a
    per-100g `base` snapshot (this time from USDA FoodData Central) + `quantity` —
    just with an `fdcId` instead of an `offId`. Anywhere code branches on
    `source === 'off'` to mean "has `base`/`quantity` to scale", it should treat
    `'off'` and `'fdc'` alike; the real distinction is against `'manual'`.
```

- [ ] **Step 4: Manually verify the full app end-to-end** (reload `http://localhost:8000/index.html`; `localStorage.removeItem('hepa_nutrition_v1')` first for a clean slate)

Repeat the same walkthrough as Task 6 Step 3 (FDC search → log → re-log from Recent; barcode scan → manual-entry barcode lookup for a real and a fake barcode) now that `foodSearch.js` is gone, to confirm nothing still imports it.

```js
// Confirm the old module is really gone and nothing references it.
try {
  await import('./js/foodSearch.js');
  console.log('FAILED: foodSearch.js still resolves');
} catch (e) {
  console.log('confirmed removed:', e.message);
}
```

In DevTools → Application → Service Workers, unregister any existing worker and hard-reload once to pick up the new `ASSETS` list; confirm the install succeeds (no "Failed to load resource" for `foodSearch.js` in the console, which would mean a stale reference survived) and the app still loads fully offline afterward (DevTools → Network → Offline, reload).

Clean up: `localStorage.removeItem('hepa_nutrition_v1')`, then reload.

- [ ] **Step 5: Commit and push**

```bash
cd "C:/Users/micha/desktop/HEPA"
git add service-worker.js CLAUDE.md
git commit -m "Remove foodSearch.js, sync service worker assets and CLAUDE.md"
git push
```
