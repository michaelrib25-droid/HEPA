import { Store } from './store.js';

export function renderSettingsView(container) {
  container.innerHTML = '';
  container.className = 'settings-view';

  const title = document.createElement('h2');
  title.textContent = 'Settings';
  container.appendChild(title);

  const heading = document.createElement('h3');
  heading.textContent = 'Daily targets';
  container.appendChild(heading);

  const current = Store.getCurrentTargets();
  const currentText = document.createElement('p');
  currentText.className = 'current-target';
  if (current) {
    const parts = [];
    if (current.calories != null) parts.push(`${current.calories} kcal`);
    if (current.protein != null) parts.push(`P ${current.protein}g`);
    if (current.carbs != null) parts.push(`C ${current.carbs}g`);
    if (current.fat != null) parts.push(`F ${current.fat}g`);
    currentText.textContent = parts.length > 0 ? `Current target: ${parts.join(' · ')}` : 'No target values set.';
  } else {
    currentText.textContent = 'No target set yet.';
  }
  container.appendChild(currentText);

  const [calField, calInput] = makeField('Calories (optional)', current ? current.calories : null);
  const [proteinField, proteinInput] = makeField('Protein g (optional)', current ? current.protein : null);
  const [carbsField, carbsInput] = makeField('Carbs g (optional)', current ? current.carbs : null);
  const [fatField, fatInput] = makeField('Fat g (optional)', current ? current.fat : null);
  [calField, proteinField, carbsField, fatField].forEach((f) => container.appendChild(f));

  const saveBtn = document.createElement('button');
  saveBtn.className = 'save-btn';
  saveBtn.textContent = 'Save targets';
  saveBtn.addEventListener('click', () => {
    Store.setTargets(
      calInput.value === '' ? null : Number(calInput.value),
      proteinInput.value === '' ? null : Number(proteinInput.value),
      carbsInput.value === '' ? null : Number(carbsInput.value),
      fatInput.value === '' ? null : Number(fatInput.value)
    );
    renderSettingsView(container);
  });
  container.appendChild(saveBtn);
}

function makeField(labelText, value) {
  const label = document.createElement('label');
  label.className = 'field-label';
  const caption = document.createElement('span');
  caption.textContent = labelText;
  const input = document.createElement('input');
  input.type = 'number';
  input.step = 'any';
  input.value = value == null ? '' : value;
  label.appendChild(caption);
  label.appendChild(input);
  return [label, input];
}
