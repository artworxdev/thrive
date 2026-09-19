import { Simulation } from '@thrive/core';
import type { SimConfig } from '@thrive/core';
import { Clock } from './clock.js';
import type { ToWorker, FromWorker } from './protocol.js';

/** Years advanced per fast-forward chunk before yielding to the message queue. */
const CHUNK_YEARS = 5;
/** Real-time playback tick, roughly 60 Hz. */
const TICK_MS = 16;

let sim: Simulation | null = null;
let config: SimConfig | null = null;
let clock = new Clock(1);
let running = false;
let ticking: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let cancelRequested = false;

function post(message: FromWorker): void {
  (self as unknown as Worker).postMessage(message);
}

function postSnapshot(): void {
  if (sim === null) return;
  post({
    type: 'snapshot',
    snapshot: sim.snapshot(),
    latest: sim.stats().at(-1) ?? null,
    running,
  });
}

function stopTicking(): void {
  running = false;
  if (ticking !== null) {
    clearInterval(ticking);
    ticking = null;
  }
}

function tick(): void {
  if (sim === null) return;
  const now = Date.now();
  const elapsed = now - lastTickAt;
  lastTickAt = now;

  sim.step(clock.advance(elapsed));
  postSnapshot();

  if (sim.extinct) {
    stopTicking();
    post({ type: 'extinct', year: sim.year });
    postSnapshot();
  }
}

function startTicking(): void {
  if (sim === null || running || sim.extinct) return;
  running = true;
  lastTickAt = Date.now();
  ticking = setInterval(tick, TICK_MS);
}

/** Advances in chunks, yielding between them so cancel can be received. */
function runToYear(target: number): void {
  if (sim === null) return;
  stopTicking();
  cancelRequested = false;

  const chunk = (): void => {
    if (sim === null) return;
    if (cancelRequested || sim.extinct || sim.year >= target) {
      post({ type: 'progressDone' });
      postSnapshot();
      if (sim.extinct) post({ type: 'extinct', year: sim.year });
      return;
    }

    sim.step(Math.min(CHUNK_YEARS, target - sim.year));
    post({ type: 'progress', year: sim.year, targetYear: target });
    postSnapshot();
    setTimeout(chunk, 0);
  };

  chunk();
}

function handle(message: ToWorker): void {
  switch (message.type) {
    case 'init':
    case 'reset': {
      stopTicking();
      cancelRequested = true;
      config = message.config;
      if (message.type === 'init') clock = new Clock(message.secondsPerYear);
      sim = Simulation.init(config, message.seed);
      postSnapshot();
      break;
    }
    case 'play':
      startTicking();
      postSnapshot();
      break;
    case 'pause':
      stopTicking();
      postSnapshot();
      break;
    case 'setSpeed':
      clock.setSpeed(message.secondsPerYear);
      break;
    case 'stepYear':
      stopTicking();
      sim?.step(1);
      postSnapshot();
      break;
    case 'runToYear':
      runToYear(message.year);
      break;
    case 'cancel':
      cancelRequested = true;
      stopTicking();
      break;
    case 'requestStats': {
      if (sim === null) break;
      const result = sim.command({
        type: 'exportStats',
        format: message.format,
      });
      if (result.type === 'stats') {
        post({ type: 'stats', format: result.format, data: result.data });
      }
      break;
    }
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  try {
    handle(event.data);
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
