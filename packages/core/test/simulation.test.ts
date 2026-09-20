import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { SimConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';

function config(over: (c: SimConfig) => void = () => {}): SimConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

/**
 * Death and extinction are properties of aging alone, so these tests disable
 * union formation. Without this they would pass in this task and break in
 * Tasks 9 and 10, when births begin to sustain the population.
 */
const barren = config((c) => {
  c.union.chance = 0;
});

describe('Simulation.init', () => {
  it('starts at year zero with the configured population', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    expect(sim.year).toBe(0);
    expect(sim.agentCount).toBe(DEFAULT_CONFIG.startingPopulation);
  });

  it('records a sample for year zero', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    expect(sim.stats()).toHaveLength(1);
    expect(sim.stats()[0]!.year).toBe(0);
    expect(sim.stats()[0]!.population).toBe(DEFAULT_CONFIG.startingPopulation);
  });

  it('rejects an invalid configuration', () => {
    expect(() =>
      Simulation.init(
        config((c) => {
          c.agentRadius = -1;
        }),
        1,
      ),
    ).toThrow(/agentRadius/);
  });
});

describe('Simulation.step', () => {
  it('advances the year by the requested amount', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    sim.step(1);
    expect(sim.year).toBeCloseTo(1, 10);
  });

  it('lands exactly on integer years after many steps', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    for (let i = 0; i < 10; i++) sim.step(1);
    expect(sim.year).toBe(10);
  });

  it('reaches the same state whether stepped in one call or several', () => {
    const coarse = Simulation.init(DEFAULT_CONFIG, 77);
    coarse.step(5);
    const fine = Simulation.init(DEFAULT_CONFIG, 77);
    for (let i = 0; i < 5; i++) fine.step(1);
    expect(fine.year).toBe(coarse.year);
    expect(fine.snapshot().agents).toEqual(coarse.snapshot().agents);
  });

  it('records one sample per simulated year', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    sim.step(10);
    expect(sim.stats().map((s) => s.year)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
  });

  it('ages the population', () => {
    const sim = Simulation.init(barren, 3);
    const before = sim.stats()[0]!.meanAge;
    sim.step(5);
    const after = sim.stats().at(-1)!.meanAge;
    // Deaths remove the oldest, so the mean does not rise by a full five.
    expect(after).toBeGreaterThan(before - 5);
    expect(after).not.toBe(before);
  });

  it('removes agents who reach their lifespan', () => {
    const sim = Simulation.init(barren, 4);
    sim.step(40);
    const deaths = sim.stats().reduce((acc, s) => acc + s.deaths, 0);
    expect(deaths).toBeGreaterThan(0);
    expect(sim.agentCount).toBe(barren.startingPopulation - deaths);
  });

  it('keeps every agent inside the world', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 5);
    sim.step(20);
    const snap = sim.snapshot();
    for (const agent of snap.agents) {
      expect(agent.x).toBeGreaterThanOrEqual(0);
      expect(agent.x).toBeLessThanOrEqual(snap.worldWidth);
      expect(agent.y).toBeGreaterThanOrEqual(0);
      expect(agent.y).toBeLessThanOrEqual(snap.worldHeight);
    }
  });

  it('keeps agents in ascending id order', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 6);
    sim.step(30);
    const ids = sim.snapshot().agents.map((a) => a.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('is deterministic for a given seed and config', () => {
    const a = Simulation.init(DEFAULT_CONFIG, 1234);
    const b = Simulation.init(DEFAULT_CONFIG, 1234);
    a.step(25);
    b.step(25);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.stats()).toEqual(b.stats());
  });

  it('diverges for a different seed', () => {
    const a = Simulation.init(DEFAULT_CONFIG, 1);
    const b = Simulation.init(DEFAULT_CONFIG, 2);
    a.step(25);
    b.step(25);
    expect(a.snapshot().agents).not.toEqual(b.snapshot().agents);
  });
});

describe('extinction', () => {
  it('empties and reports extinct once everyone has died of old age', () => {
    const sim = Simulation.init(barren, 8);
    sim.step(200);
    expect(sim.agentCount).toBe(0);
    expect(sim.extinct).toBe(true);
    expect(sim.snapshot().extinct).toBe(true);
  });

  it('stops advancing the year once extinct', () => {
    const sim = Simulation.init(barren, 8);
    sim.step(200);
    const yearAtExtinction = sim.year;
    const samples = sim.stats().length;
    sim.step(50);
    expect(sim.year).toBe(yearAtExtinction);
    expect(sim.stats()).toHaveLength(samples);
  });
});

describe('snapshot', () => {
  it('reports world dimensions, radius and capacity flags', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    const snap = sim.snapshot();
    expect(snap.worldWidth).toBe(DEFAULT_CONFIG.world.width);
    expect(snap.worldHeight).toBe(DEFAULT_CONFIG.world.height);
    expect(snap.agentRadius).toBe(DEFAULT_CONFIG.agentRadius);
    expect(snap.atCapacity).toBe(false);
    expect(snap.extinct).toBe(false);
  });

  it('exposes plain data rather than live agents', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    const first = sim.snapshot();
    sim.step(1);
    const second = sim.snapshot();
    expect(second.agents[0]).not.toBe(first.agents[0]);
  });

  it('includes age and partner id for each agent', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 1);
    const agent = sim.snapshot().agents[0]!;
    expect(typeof agent.age).toBe('number');
    expect(agent.partnerId).toBeNull();
  });
});
