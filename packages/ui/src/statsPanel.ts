import type { StatsSample } from '@thrive/core';

const ROWS: Array<[string, (s: StatsSample) => string]> = [
  ['Year', (s) => s.year.toFixed(0)],
  ['Population', (s) => String(s.population)],
  ['Male / female', (s) => s.males + ' / ' + s.females],
  ['Active unions', (s) => String(s.activeUnions)],
  ['Births this year', (s) => String(s.births)],
  ['Deaths this year', (s) => String(s.deaths)],
  ['Mean age', (s) => s.meanAge.toFixed(1)],
  ['Suppressed births', (s) => String(s.suppressedBirths)],
];

export function renderStats(
  target: HTMLElement,
  sample: StatsSample | null,
): void {
  target.textContent = '';
  if (sample === null) return;

  for (const [label, read] of ROWS) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = read(sample);
    target.append(dt, dd);
  }
}
