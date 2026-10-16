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
