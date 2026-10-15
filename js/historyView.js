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
    const [gramsField, gramsInput] = makeField('Grams', entry.quantity.mode === 'grams'
      ? entry.quantity.grams
      : entry.quantity.servings * entry.quantity.gramsPerServing, 'number');
    entriesContainer.appendChild(gramsField);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', () => {
      Store.updateEntryQuantity(entry.id, { mode: 'grams', grams: Number(gramsInput.value) || 0 });
      renderHistoryView(rootContainer);
    });
    entriesContainer.appendChild(saveBtn);
  } else {
    const [nameField, nameInput] = makeField('Name', entry.name, 'text');
    const [calField, calInput] = makeField('Calories', entry.nutrients.calories, 'number');
    const [proteinField, proteinInput] = makeField('Protein (g)', entry.nutrients.protein, 'number');
    const [carbsField, carbsInput] = makeField('Carbs (g)', entry.nutrients.carbs, 'number');
    const [fatField, fatInput] = makeField('Fat (g)', entry.nutrients.fat, 'number');
    [nameField, calField, proteinField, carbsField, fatField].forEach((f) => entriesContainer.appendChild(f));

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

function makeField(labelText, value, type) {
  const label = document.createElement('label');
  label.className = 'field-label';
  const caption = document.createElement('span');
  caption.textContent = labelText;
  const input = document.createElement('input');
  input.type = type;
  input.value = value;
  label.appendChild(caption);
  label.appendChild(input);
  return [label, input];
}
