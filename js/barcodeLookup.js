import { fetchWithRetry } from './httpRetry.js';

const PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product';

export async function lookupBarcode(barcode) {
  const url = `${PRODUCT_URL}/${encodeURIComponent(barcode)}.json`;
  let res;
  try {
    res = await fetchWithRetry(url, { label: 'Barcode lookup' });
  } catch (e) {
    // OFF signals "barcode not found" inconsistently: a malformed/degenerate
    // code (e.g. all zeros) gets HTTP 200 with status:0, but a well-formed
    // code OFF has simply never catalogued gets HTTP 404 (also status:0 in
    // the body) — both mean "not found", not "network/server failure".
    if (e.status === 404) return null;
    throw e;
  }
  const data = await res.json();
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
