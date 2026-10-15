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

// Local-calendar-day date string (not UTC) — a UTC slice would misdate
// entries logged late at night in timezones ahead of UTC (e.g. a 00:30
// local entry in Europe/Berlin is still 22:30 UTC the previous day).
export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
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
      const dateStr = todayIso(d);
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
