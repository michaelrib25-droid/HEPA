const SEARCH_URL = 'https://world.openfoodfacts.org/cgi/search.pl';
const TIMEOUT_MS = 8000;

const RESULT_LIMIT = 8;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 400;

export async function searchFoods(query) {
  const url = `${SEARCH_URL}?search_terms=${encodeURIComponent(query)}&search_simple=1&action=process&json=1&page_size=${RESULT_LIMIT}&sort_by=unique_scans_n&lc=en`;
  const res = await fetchWithRetry(url);
  const data = await res.json();
  const products = Array.isArray(data.products) ? data.products : [];
  return products
    .filter((p) => p.product_name && p.nutriments && p.nutriments['energy-kcal_100g'] != null)
    .map(normalizeProduct);
}

// OFF's search endpoint intermittently returns fast 5xx responses under load
// (observed independent of query params) — a couple of quick retries clears
// most of them without meaningfully delaying a genuine offline/timeout failure.
async function fetchWithRetry(url) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.ok) return res;
    if (res.status < 500 || attempt === MAX_ATTEMPTS) {
      throw new Error(`Open Food Facts request failed: ${res.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
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
