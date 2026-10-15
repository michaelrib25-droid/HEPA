import { renderLogView } from './logView.js';
import { renderHistoryView } from './historyView.js';
import { renderTrendsView } from './trendsView.js';
import { renderSettingsView } from './settingsView.js';

const appRoot = document.getElementById('app');

const TABS = [
  { id: 'log', label: 'Log' },
  { id: 'history', label: 'History' },
  { id: 'trends', label: 'Trends' },
  { id: 'settings', label: 'Settings' }
];

let activeTab = 'log';

function render() {
  appRoot.innerHTML = '';

  const nav = document.createElement('nav');
  nav.className = 'tab-nav';
  TABS.forEach((tab) => {
    const btn = document.createElement('button');
    btn.textContent = tab.label;
    btn.className = tab.id === activeTab ? 'active' : '';
    btn.addEventListener('click', () => {
      activeTab = tab.id;
      render();
    });
    nav.appendChild(btn);
  });
  appRoot.appendChild(nav);

  const viewContainer = document.createElement('div');
  viewContainer.className = 'view-container';
  appRoot.appendChild(viewContainer);

  if (activeTab === 'log') {
    renderLogView(viewContainer);
  } else if (activeTab === 'history') {
    renderHistoryView(viewContainer);
  } else if (activeTab === 'trends') {
    renderTrendsView(viewContainer);
  } else if (activeTab === 'settings') {
    renderSettingsView(viewContainer);
  }
}

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js');
  });
}

render();
