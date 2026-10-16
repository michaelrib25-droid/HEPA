import { fetchWithRetry } from './httpRetry.js';

const API_KEY = 'LUcDLnO55N7bY2fflqNNyfgm8xMki5ZLqcpZVMdM'; // from https://api.data.gov/signup/
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
