import { Store, todayIso } from './store.js';
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
