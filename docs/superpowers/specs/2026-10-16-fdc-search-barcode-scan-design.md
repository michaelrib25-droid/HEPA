# HEPA – FDC Text Search + OFF Barcode Lookup (Design)

Supersedes parts of `2026-10-15-hepa-nutrition-tracker-design.md`: that spec
chose Open Food Facts (OFF) text search as the sole food-lookup path and
explicitly excluded barcode scanning. Both are revised here.

## Why

OFF's legacy text-search backend (`cgi/search.pl`, used by `js/foodSearch.js`)
is being deprecated by OFF itself and has been intermittently returning fast
503s throughout the investigation that led to this spec (confirmed via
repeated direct requests, and via OFF's own `openfoodfacts-upptime` GitHub
issues showing recurring "Search API v2 is down" reports). A short retry (see
the "Retry OFF search on transient 5xx responses" commit) helps but doesn't
fix an unreliable upstream. OFF's intended replacement, the Search-a-licious
API (`search.openfoodfacts.org`), was live-tested and found to have no CORS
headers for third-party origins — unusable from a backend-less PWA without
introducing a proxy or server, which this project deliberately avoids.

Two other things pushed this change beyond "just fix the outage":

- OFF's text search is a barcode-scan database of branded products, so even
  working normally it rarely returns a single clean generic answer for staple
  foods ("banana" → many branded bananas, no plain "banana ≈ 89 kcal/100g").
- OFF's barcode-lookup endpoint (`api/v2/product/{barcode}.json`) — a
  completely separate service from text search — stayed reliable throughout
  the outage and has open CORS. It's a natural fit for specific supermarket
  products once you have the item in hand.

## Decision

- **Text search switches from OFF to USDA FoodData Central (FDC).** Confirmed
  live: open CORS, free API key (embeddable client-side, not a secret — see
  "FDC API key" below), and for generic queries returns exactly the single
  clean estimate originally wanted (e.g. "Banana, raw", USDA SR Legacy
  dataset). Trade-off, accepted by the user: weaker coverage of German/EU
  packaged branded products than OFF had.
- **Add an independent OFF barcode-lookup path** for specific supermarket
  products, with camera scanning as the primary input and manual digit entry
  always available alongside it (not only as a fallback when the camera is
  unavailable).
- These two paths are both reachable from the Log tab as separate entry
  points (search box + a "Scan barcode" button), not merged into one input or
  a tab switcher.

## Data model (`js/store.js`)

Extends the existing two-shape model (`docs/superpowers/specs/2026-10-15-...`)
with a third source. The shape-determining property was never really "which
provider" — it's "does this entry have a per-100g `base` to scale, or an
absolute `nutrients` total" — so this generalizes cleanly:

```js
{
  id, date, loggedAt, name,
  source: "fdc",                  // new
  fdcId: 1105073,                 // FDC's fdcId, analogous to offId
  base: { calories, protein, carbs, fat, fiber, sugar },  // per 100g
  quantity: { mode: "grams", grams: 150 }  // same shape as off/quantity
}
```

- `source: "off"` entries are unchanged — barcode lookups produce exactly the
  same shape OFF text search used to (they're the same provider, just found a
  different way), including still being OFF's immutable per-100g snapshot.
- `source: "fdc"` mirrors `source: "off"` structurally; only the id field
  name and provenance differ.
- `source: "manual"` is unchanged.

Code currently branches on the literal string `'off'` in four places where it
really means "has `base`/`quantity`, scale it" as opposed to manual's
absolute totals. These need to generalize to "anything that isn't manual"
(or explicitly handle `'off'` and `'fdc'` alike) as part of this work:
  - `store.js: updateEntryQuantity` (`entry.source !== 'off'` guard)
  - `store.js: getRecentFrequentFoods` (per-source dedup key)
  - `logView.js: renderPortionFromEntry` (which id field to read, which
    `Store.add*Entry` to call on save)
  - `historyView.js: renderEditForm` (grams-edit branch vs. manual-fields
    branch)

`deriveNutrients()` in `store.js` already branches on `source === 'manual'`
vs. everything else, so it needs no change — it already treats `'fdc'`
correctly once entries have the matching shape.

## Module structure

`js/foodSearch.js` is removed, replaced by three isolated modules (keeping
the existing rule that network calls stay out of view/store code):

- **`js/fdcSearch.js`** — FDC text search. Normalizes FDC's nutrient array
  (`foodNutrients: [{nutrientName, value, unitName}, ...]`) into the
  existing flat `base` shape. Sorts results so `dataType` values `Foundation`,
  `SR Legacy`, and `Survey (FNDDS)` (generic foods) rank above `Branded`
  (packaged products), capped at 8 results like the current OFF search.
- **`js/barcodeLookup.js`** — calls OFF's `api/v2/product/{barcode}.json`,
  normalizes the result into the same `base` shape `fdcSearch.js` and the old
  `foodSearch.js` used, so `renderPortion()` in `logView.js` doesn't need to
  know which provider a result came from.
- **`js/barcodeScanner.js`** — camera concerns only: feature-detects
  `BarcodeDetector` (supported on Chrome Android, this project's only target,
  per live-checked caniuse data), manages the `getUserMedia` video stream and
  its cleanup, and hands a detected barcode string to `barcodeLookup.js`. Kept
  separate from the network call so camera lifecycle code doesn't tangle with
  fetch/retry logic.

The retry-on-5xx-with-timeout helper just added to the old `foodSearch.js`
moves to a small shared module, **`js/httpRetry.js`**, and both
`fdcSearch.js` and `barcodeLookup.js` import it — identical logic in two
network modules is worth sharing rather than duplicating, and an ES module
import costs nothing given there's no build step to coordinate.

## FDC API key

FDC requires an `api_key` query param. The public `DEMO_KEY` is shared
globally at 30 requests/hour and unusable for real traffic; the user needs
their own free key (instant signup at api.data.gov/signup — a step only the
user can do, it's a form submission requiring their email). It gets hardcoded
as a constant in `fdcSearch.js`, the same pattern `SEARCH_URL` used in the old
`foodSearch.js` — it's a free, rate-limited identifier, not a secret, so no
settings-UI storage is needed.

## UI (Log tab)

- The existing search box stays in place, now calling `fdcSearch.js` instead
  of the old `foodSearch.js`. Same debounce, same loading/error/empty states.
- A new "📷 Scan barcode" button sits next to it, opening a camera view:
  - `BarcodeDetector` supported → live camera feed, auto-detects a barcode,
    stops the camera and looks it up via `barcodeLookup.js` on detection.
  - A "Enter barcode manually" link/field is visible in this view
    regardless of camera support (not just as an unsupported-browser
    fallback) — covers low light, damaged barcodes, or just not wanting to
    use the camera.
  - Not found (404) or exhausted retries on a 5xx → the same inline-message +
    "add manually" fallback pattern `logView.js` already uses for search
    failures.
  - Camera permission denied → immediately show the manual-entry field with a
    short inline explanation, no dead end.
- Both paths land on the existing `renderPortion()` quantity-entry screen
  (grams/serving), generalized to carry either an `offId` or `fdcId` through
  to the matching `Store.add*Entry` call.

## Error handling

Unchanged philosophy from the original spec: the rest of the app (history,
trends, manual entry) must stay fully usable regardless of network state.
Both new network modules degrade to an inline message on failure, same as
the current search does — no path should ever hard-fail the Log tab.

## Explicitly out of scope (for this change)

- Editing/re-fetching a logged entry's `base` after the fact (same rule as
  today — it's an immutable snapshot at log time).
- Any backend/proxy component — ruled out specifically because it was the
  reason Search-a-licious wasn't viable either; introducing one here would
  undercut the whole no-backend architecture for a single-user phone PWA.
- iOS/non-Chrome barcode-scanning fallback libraries — this project targets
  one Android phone running Chrome, where `BarcodeDetector` is supported
  natively.
