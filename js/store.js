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
