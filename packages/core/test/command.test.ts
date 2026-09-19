import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import { STATS_CSV_HEADER } from '../src/stats.js';

describe('command: runToYear', () => {
  it('advances to the requested year', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    sim.command({ type: 'runToYear', year: 25 });
    expect(sim.year).toBe(25);
  });

  it('returns ok', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    expect(sim.command({ type: 'runToYear', year: 5 })).toEqual({ type: 'ok' });
  });

  it('does nothing when the target is already past', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    sim.step(30);
    const before = sim.snapshot();
    sim.command({ type: 'runToYear', year: 10 });
    expect(sim.year).toBe(30);
    expect(sim.snapshot()).toEqual(before);
  });

  it('matches the state reached by stepping directly', () => {
    const viaCommand = Simulation.init(DEFAULT_CONFIG, 52);
    viaCommand.command({ type: 'runToYear', year: 40 });
    const viaStep = Simulation.init(DEFAULT_CONFIG, 52);
    viaStep.step(40);
    expect(viaCommand.snapshot()).toEqual(viaStep.snapshot());
    expect(viaCommand.stats()).toEqual(viaStep.stats());
  });
});

describe('command: reset', () => {
  it('returns to year zero with the starting population', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 53);
    sim.step(40);
    sim.command({ type: 'reset', seed: 53 });
    expect(sim.year).toBe(0);
    expect(sim.agentCount).toBe(DEFAULT_CONFIG.startingPopulation);
  });

  it('discards the previous stats series', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 53);
    sim.step(40);
    sim.command({ type: 'reset', seed: 53 });
    expect(sim.stats()).toHaveLength(1);
    expect(sim.stats()[0]!.year).toBe(0);
  });

  it('reproduces the original run when reset to the same seed', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 54);
    sim.step(30);
    const original = sim.snapshot();

    sim.command({ type: 'reset', seed: 54 });
    sim.step(30);
    expect(sim.snapshot()).toEqual(original);
  });

  it('produces a different run for a different seed', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 54);
    sim.step(30);
    const original = sim.snapshot().agents;

    sim.command({ type: 'reset', seed: 55 });
    sim.step(30);
    expect(sim.snapshot().agents).not.toEqual(original);
  });

  it('clears unions and partner links', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 56);
    sim.step(30);
    sim.command({ type: 'reset', seed: 56 });
    expect(sim.stats()[0]!.activeUnions).toBe(0);
    for (const agent of sim.snapshot().agents) {
      expect(agent.partnerId).toBeNull();
    }
  });

  it('revives a simulation that had gone extinct', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 57);
    sim.step(250);
    sim.command({ type: 'reset', seed: 57 });
    expect(sim.extinct).toBe(false);
    sim.step(1);
    expect(sim.year).toBe(1);
  });
});

describe('command: exportStats', () => {
  it('returns CSV with the shared header', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 58);
    sim.step(5);
    const result = sim.command({ type: 'exportStats', format: 'csv' });
    expect(result.type).toBe('stats');
    if (result.type !== 'stats') throw new Error('expected stats');
    expect(result.format).toBe('csv');
    expect(result.data.split('\n')[0]).toBe(STATS_CSV_HEADER);
    expect(result.data.trim().split('\n')).toHaveLength(7);
  });

  it('returns JSON that parses back to the series', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 58);
    sim.step(5);
    const result = sim.command({ type: 'exportStats', format: 'json' });
    if (result.type !== 'stats') throw new Error('expected stats');
    expect(JSON.parse(result.data)).toEqual(sim.stats());
  });
});
