import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation, DEFAULT_CONFIG } from '@thrive/core';
import type { StatsSeries } from '@thrive/core';
import { GOLDEN_PATH, GOLDEN_SEED, GOLDEN_YEARS } from './golden-spec.js';
import { runSimulation } from '../src/index.js';

function golden(): StatsSeries {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as StatsSeries;
}

describe('golden run', () => {
  it('reproduces the committed fixture exactly', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, GOLDEN_SEED);
    sim.command({ type: 'runToYear', year: GOLDEN_YEARS });
    expect(sim.stats()).toEqual(golden());
  });

  it('has a sample for every year including year zero', () => {
    expect(golden()).toHaveLength(GOLDEN_YEARS + 1);
  });

  it('is a non-trivial run', () => {
    const series = golden();
    expect(series.reduce((acc, s) => acc + s.births, 0)).toBeGreaterThan(0);
    expect(series.reduce((acc, s) => acc + s.deaths, 0)).toBeGreaterThan(0);
    expect(Math.max(...series.map((s) => s.activeUnions))).toBeGreaterThan(0);
  });

  it('matches what the CLI path produces', () => {
    const output = runSimulation(
      {
        years: GOLDEN_YEARS,
        seed: GOLDEN_SEED,
        format: 'json',
        configPath: null,
        outPath: null,
      },
      structuredClone(DEFAULT_CONFIG),
    );
    expect(JSON.parse(output)).toEqual(golden());
  });
});
