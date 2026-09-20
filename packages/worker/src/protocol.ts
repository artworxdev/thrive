import type { SimConfig, Snapshot, StatsSample } from '@thrive/core';

export type ToWorker =
  | { type: 'init'; config: SimConfig; seed: number; secondsPerYear: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setSpeed'; secondsPerYear: number }
  | { type: 'stepYear' }
  | { type: 'runToYear'; year: number }
  | { type: 'cancel' }
  | { type: 'reset'; config: SimConfig; seed: number }
  | { type: 'requestStats'; format: 'csv' | 'json' };

export type FromWorker =
  | {
      type: 'snapshot';
      snapshot: Snapshot;
      latest: StatsSample | null;
      running: boolean;
    }
  | { type: 'progress'; year: number; targetYear: number }
  | { type: 'progressDone' }
  | { type: 'stats'; format: 'csv' | 'json'; data: string }
  | { type: 'extinct'; year: number }
  | { type: 'error'; message: string };
