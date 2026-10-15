import { Store, isoWeekKey } from './store.js';
import { renderLineChart } from './chart.js';

export function renderTrendsView(container) {
  container.innerHTML = '';
  container.className = 'trends-view';

  const title = document.createElement('h2');
  title.textContent = 'Trends';
  container.appendChild(title);

  const daily = Store.getDailyTotals();
  if (daily.length === 0) {
    const hint = document.createElement('p');
    hint.className = 'empty-hint';
    hint.textContent = 'No trends yet — log some food in the Log tab first.';
    container.appendChild(hint);
    return;
  }

  let granularity = 'daily';

  const toggleRow = document.createElement('div');
  toggleRow.className = 'granularity-toggle';
  const dailyBtn = document.createElement('button');
  dailyBtn.type = 'button';
  dailyBtn.textContent = 'Daily';
  const weeklyBtn = document.createElement('button');
  weeklyBtn.type = 'button';
  weeklyBtn.textContent = 'Weekly avg';
  toggleRow.appendChild(dailyBtn);
  toggleRow.appendChild(weeklyBtn);
  container.appendChild(toggleRow);

  const caloriesHeading = document.createElement('h3');
  caloriesHeading.textContent = 'Calories';
  container.appendChild(caloriesHeading);
  const caloriesChartContainer = document.createElement('div');
  container.appendChild(caloriesChartContainer);

  const macrosHeading = document.createElement('h3');
  macrosHeading.textContent = 'Macros';
  container.appendChild(macrosHeading);
  const macrosChartContainer = document.createElement('div');
  container.appendChild(macrosChartContainer);

  const streakContainer = document.createElement('div');
  container.appendChild(streakContainer);

  function updateButtons() {
    dailyBtn.className = granularity === 'daily' ? 'active' : '';
    weeklyBtn.className = granularity === 'weekly' ? 'active' : '';
  }

  function renderCharts() {
    updateButtons();

    let labels;
    let totalsList;
    if (granularity === 'daily') {
      labels = daily.map((d) => d.date);
      totalsList = daily.map((d) => d.totals);
    } else {
      const weekly = Store.getWeeklyAverages();
      labels = weekly.map((w) => w.week);
      totalsList = weekly.map((w) => w.totals);
    }

    const weightPoints = Store.getHtpaBodyweightPoints();
    const weightAligned = alignWeightToLabels(weightPoints, labels, granularity);

    const calorieSeriesList = [
      {
        label: 'Calories',
        points: labels.map((l, i) => ({
          x: l,
          y: totalsList[i].calories,
          tooltip: `${Math.round(totalsList[i].calories)} kcal`
        }))
      }
    ];
    if (weightAligned.some((v) => v != null)) {
      calorieSeriesList.push({
        label: 'Weight',
        axis: 'secondary',
        points: labels.map((l, i) => ({
          x: l,
          y: weightAligned[i],
          tooltip: weightAligned[i] != null ? `${weightAligned[i]} kg` : ''
        }))
      });
    }
    renderLineChart(caloriesChartContainer, calorieSeriesList);

    renderLineChart(macrosChartContainer, [
      { label: 'Protein', points: labels.map((l, i) => ({ x: l, y: totalsList[i].protein, tooltip: `${Math.round(totalsList[i].protein)}g` })) },
      { label: 'Carbs', points: labels.map((l, i) => ({ x: l, y: totalsList[i].carbs, tooltip: `${Math.round(totalsList[i].carbs)}g` })) },
      { label: 'Fat', points: labels.map((l, i) => ({ x: l, y: totalsList[i].fat, tooltip: `${Math.round(totalsList[i].fat)}g` })) }
    ]);

    streakContainer.innerHTML = '';
    const streak = Store.getGoalStreak(30);
    if (streak.counted > 0) {
      const streakText = document.createElement('p');
      streakText.className = 'goal-streak';
      streakText.textContent = `On target ${streak.onTarget} of the last ${streak.counted} logged days (last 30 days).`;
      streakContainer.appendChild(streakText);
    }
  }

  dailyBtn.addEventListener('click', () => { granularity = 'daily'; renderCharts(); });
  weeklyBtn.addEventListener('click', () => { granularity = 'weekly'; renderCharts(); });

  renderCharts();
}

function alignWeightToLabels(weightPoints, labels, granularity) {
  if (granularity === 'daily') {
    const byDate = new Map(weightPoints.map((p) => [p.date, p.weight]));
    return labels.map((d) => (byDate.has(d) ? byDate.get(d) : null));
  }
  const byWeek = new Map();
  weightPoints.forEach((p) => {
    const week = isoWeekKey(p.date);
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(p.weight);
  });
  return labels.map((w) => {
    const vals = byWeek.get(w);
    if (!vals || vals.length === 0) return null;
    return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
  });
}
