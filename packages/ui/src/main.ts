import './styles.css';
import type { Snapshot, StatsSample } from '@thrive/core';
import { SimClient } from './simClient.js';
import { fitViewport } from './viewport.js';
import { drawScene } from './renderer.js';
import { drawChart } from './chart.js';
import { renderStats } from './statsPanel.js';
import { ConfigEditor, requireElement } from './controls.js';

const worldCanvas = requireElement<HTMLCanvasElement>('world');
const chartCanvas = requireElement<HTMLCanvasElement>('chart');
const statusEl = requireElement<HTMLParagraphElement>('status');
const statsEl = requireElement<HTMLElement>('statsNumbers');
const playButton = requireElement<HTMLButtonElement>('play');
const cancelButton = requireElement<HTMLButtonElement>('cancel');
const speedInput = requireElement<HTMLInputElement>('speed');
const speedValue = requireElement<HTMLOutputElement>('speedValue');
const seedInput = requireElement<HTMLInputElement>('seed');
const targetYearInput = requireElement<HTMLInputElement>('targetYear');
const colorByAgeInput = requireElement<HTMLInputElement>('colorByAge');

const editor = new ConfigEditor(
  requireElement<HTMLTextAreaElement>('config'),
  requireElement<HTMLElement>('configError'),
);

const worldCtx = worldCanvas.getContext('2d');
const chartCtx = chartCanvas.getContext('2d');
if (worldCtx === null || chartCtx === null) {
  throw new Error('Canvas 2D context unavailable');
}

let latestSnapshot: Snapshot | null = null;
let series: StatsSample[] = [];
let running = false;
let frameRequested = false;

function setStatus(message: string | null): void {
  statusEl.hidden = message === null;
  statusEl.textContent = message ?? '';
}

function resizeCanvases(): void {
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [worldCanvas, chartCanvas]) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  requestDraw();
}

/**
 * Draws at most once per animation frame from whatever the latest snapshot is.
 * If the simulation outruns the display, frames are skipped, never queued.
 */
function requestDraw(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (latestSnapshot === null) return;
    const viewport = fitViewport(
      latestSnapshot.worldWidth,
      latestSnapshot.worldHeight,
      worldCanvas.width,
      worldCanvas.height,
    );
    drawScene(worldCtx!, latestSnapshot, viewport, {
      colorByAge: colorByAgeInput.checked,
    });
    drawChart(chartCtx!, series);
  });
}

const client = new SimClient({
  onSnapshot(snapshot, latest, isRunning) {
    latestSnapshot = snapshot;
    running = isRunning;
    playButton.textContent = isRunning ? 'Pause' : 'Play';
    if (latest !== null) {
      const last = series[series.length - 1];
      if (last === undefined || latest.year > last.year) series.push(latest);
      else if (latest.year === last.year) series[series.length - 1] = latest;
      renderStats(statsEl, latest);
    }
    if (snapshot.atCapacity) {
      setStatus('At capacity — births are being suppressed');
    } else if (!snapshot.extinct) {
      setStatus(null);
    }
    requestDraw();
  },
  onProgress(year, targetYear) {
    cancelButton.disabled = false;
    setStatus(
      'Fast-forwarding: year ' + year.toFixed(0) + ' of ' + String(targetYear),
    );
  },
  onProgressDone() {
    cancelButton.disabled = true;
    setStatus(null);
  },
  onStats(format, data) {
    const blob = new Blob([data], {
      type: format === 'csv' ? 'text/csv' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'thrive-stats.' + format;
    link.click();
    URL.revokeObjectURL(url);
  },
  onExtinct(year) {
    setStatus('Extinct at year ' + year.toFixed(0));
    playButton.textContent = 'Play';
  },
  onError(message) {
    setStatus('Error: ' + message);
  },
});

function currentSeed(): number {
  const seed = Number(seedInput.value);
  return Number.isFinite(seed) ? seed : 1;
}

function start(): void {
  const config = editor.read();
  if (config === null) return;
  series = [];
  setStatus(null);
  client.init(config, currentSeed(), Number(speedInput.value));
}

playButton.addEventListener('click', () => {
  if (running) client.pause();
  else client.play();
});

requireElement<HTMLButtonElement>('stepYear').addEventListener('click', () => {
  client.stepYear();
});

requireElement<HTMLButtonElement>('reset').addEventListener('click', () => {
  const config = editor.read();
  if (config === null) return;
  series = [];
  setStatus(null);
  client.reset(config, currentSeed());
});

requireElement<HTMLButtonElement>('runTo').addEventListener('click', () => {
  const target = Number(targetYearInput.value);
  if (Number.isFinite(target)) client.runToYear(target);
});

cancelButton.addEventListener('click', () => {
  client.cancel();
});

requireElement<HTMLButtonElement>('exportCsv').addEventListener('click', () => {
  client.requestStats('csv');
});

speedInput.addEventListener('input', () => {
  speedValue.value = Number(speedInput.value).toFixed(2) + ' s';
  client.setSpeed(Number(speedInput.value));
});

colorByAgeInput.addEventListener('change', requestDraw);
window.addEventListener('resize', resizeCanvases);

speedInput.value = '1';
speedValue.value = '1.00 s';
resizeCanvases();
start();
