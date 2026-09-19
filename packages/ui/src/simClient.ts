import type { SimConfig, Snapshot, StatsSample } from '@thrive/core';
import type { ToWorker, FromWorker } from '@thrive/worker/src/protocol.js';

export interface SimClientHandlers {
  onSnapshot(snapshot: Snapshot, latest: StatsSample | null, running: boolean): void;
  onProgress(year: number, targetYear: number): void;
  onProgressDone(): void;
  onStats(format: 'csv' | 'json', data: string): void;
  onExtinct(year: number): void;
  onError(message: string): void;
}

/**
 * Main-thread wrapper around the simulation worker. The UI never holds a
 * Simulation; it only ever sees the snapshots this client forwards.
 */
export class SimClient {
  private readonly worker: Worker;

  constructor(private readonly handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case 'snapshot':
          handlers.onSnapshot(message.snapshot, message.latest, message.running);
          break;
        case 'progress':
          handlers.onProgress(message.year, message.targetYear);
          break;
        case 'progressDone':
          handlers.onProgressDone();
          break;
        case 'stats':
          handlers.onStats(message.format, message.data);
          break;
        case 'extinct':
          handlers.onExtinct(message.year);
          break;
        case 'error':
          handlers.onError(message.message);
          break;
      }
    });

    // A crashed worker must surface, not leave a frozen canvas on screen.
    this.worker.addEventListener('error', (event) => {
      handlers.onError('Simulation worker failed: ' + event.message);
    });
  }

  init(config: SimConfig, seed: number, secondsPerYear: number): void {
    this.send({ type: 'init', config, seed, secondsPerYear });
  }

  reset(config: SimConfig, seed: number): void {
    this.send({ type: 'reset', config, seed });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  setSpeed(secondsPerYear: number): void {
    this.send({ type: 'setSpeed', secondsPerYear });
  }

  stepYear(): void {
    this.send({ type: 'stepYear' });
  }

  runToYear(year: number): void {
    this.send({ type: 'runToYear', year });
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  requestStats(format: 'csv' | 'json'): void {
    this.send({ type: 'requestStats', format });
  }

  terminate(): void {
    this.worker.terminate();
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }
}
