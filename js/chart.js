const WIDTH = 320;
const HEIGHT = 160;
const PADDING = 24;
const DEFAULT_COLORS = ['#4f6df5', '#ff9f43', '#2ed573', '#ff6b6b'];

export function renderLineChart(container, series) {
  container.innerHTML = '';

  const maxLen = Math.max(...series.map((s) => s.points.length));
  const xStep = maxLen > 1 ? (WIDTH - PADDING * 2) / (maxLen - 1) : 0;

  const primaryPoints = series.filter((s) => s.axis !== 'secondary').flatMap((s) => s.points);
  const secondaryPoints = series.filter((s) => s.axis === 'secondary').flatMap((s) => s.points);
  const primaryRange = valueRange(primaryPoints);
  const secondaryRange = secondaryPoints.length ? valueRange(secondaryPoints) : null;

  function scaleY(value, range) {
    if (range.span === 0) return HEIGHT / 2;
    return HEIGHT - PADDING - ((value - range.min) / range.span) * (HEIGHT - PADDING * 2);
  }

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
  svg.setAttribute('class', 'trend-chart-svg');

  series.forEach((s, idx) => {
    const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
    const range = s.axis === 'secondary' ? secondaryRange : primaryRange;
    // Points may carry `y: null` to mark a gap at that x-slot (e.g. a day with
    // no weight entry) while still occupying its index — skipping null here
    // (rather than filtering the array beforehand) keeps every series aligned
    // to the same x position per shared label, even when series have gaps.
    const coords = [];
    s.points.forEach((p, i) => {
      if (p.y == null) return;
      coords.push({ x: PADDING + i * xStep, y: scaleY(p.y, range), tooltip: p.tooltip });
    });

    if (coords.length > 1) {
      const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      polyline.setAttribute('points', coords.map((c) => `${c.x},${c.y}`).join(' '));
      polyline.setAttribute('fill', 'none');
      polyline.setAttribute('stroke', color);
      polyline.setAttribute('stroke-width', '2');
      if (s.axis === 'secondary') polyline.setAttribute('stroke-dasharray', '4,3');
      svg.appendChild(polyline);
    }

    coords.forEach((c) => {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', c.x);
      circle.setAttribute('cy', c.y);
      circle.setAttribute('r', '3.5');
      circle.setAttribute('fill', color);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = c.tooltip;
      circle.appendChild(title);
      svg.appendChild(circle);
    });
  });

  container.appendChild(svg);

  if (series.length > 1) {
    const legend = document.createElement('div');
    legend.className = 'trend-chart-legend';
    series.forEach((s, idx) => {
      const color = s.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length];
      const item = document.createElement('span');
      item.className = 'legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'legend-swatch';
      swatch.style.background = color;
      item.appendChild(swatch);
      item.appendChild(document.createTextNode(s.label));
      legend.appendChild(item);
    });
    container.appendChild(legend);
  }

  const labelSeries = series.find((s) => s.points.length > 0);
  if (labelSeries) {
    const labels = document.createElement('div');
    labels.className = 'trend-chart-labels';
    const first = document.createElement('span');
    first.textContent = labelSeries.points[0].x;
    const last = document.createElement('span');
    last.textContent = labelSeries.points[labelSeries.points.length - 1].x;
    labels.appendChild(first);
    labels.appendChild(last);
    container.appendChild(labels);
  }
}

function valueRange(points) {
  const values = points.map((p) => p.y).filter((y) => y != null);
  if (values.length === 0) return { min: 0, max: 1, span: 1 };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return { min, max, span: max - min };
}
