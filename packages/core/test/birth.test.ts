import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { SimConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';

function config(over: (c: SimConfig) => void): SimConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

describe('births', () => {
  it('produces offspring under the default config', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 41);
    sim.step(40);
    const births = sim.stats().reduce((acc, s) => acc + s.births, 0);
    expect(births).toBeGreaterThan(0);
  });

  it('produces no offspring when the birth chance is zero', () => {
    const sim = Simulation.init(
      config((c) => {
        c.birthChancePerYear = 0;
      }),
      41,
    );
    sim.step(40);
    expect(sim.stats().reduce((acc, s) => acc + s.births, 0)).toBe(0);
  });

  it('produces no offspring when unions never form', () => {
    const sim = Simulation.init(
      config((c) => {
        c.union.chance = 0;
      }),
      41,
    );
    sim.step(40);
    expect(sim.stats().reduce((acc, s) => acc + s.births, 0)).toBe(0);
  });

  it('records births only at year boundaries', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 42);
    sim.step(30);
    for (const sample of sim.stats()) {
      expect(Number.isInteger(sample.year)).toBe(true);
    }
  });

  it('assigns each newborn a fresh ascending id', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 43);
    sim.step(30);
    const ids = sim.snapshot().agents.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(Math.max(...ids)).toBeGreaterThanOrEqual(
      DEFAULT_CONFIG.startingPopulation,
    );
  });

  it('starts every newborn at age zero, unpartnered', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 44);
    // Stepping only 15 years, rather than 30, keeps every newborn below the
    // default fertility minAge of 18, so none of them can have formed a
    // union yet — this test is about the state a newborn starts in, not
    // about whether it stays unpartnered indefinitely. (At 30 years, a
    // newborn from early in the run can legitimately reach fertility age
    // and pair up, which is correct behaviour, not a bug.)
    sim.step(15);
    const newborns = sim
      .snapshot()
      .agents.filter((a) => a.id >= DEFAULT_CONFIG.startingPopulation);
    expect(newborns.length).toBeGreaterThan(0);
    for (const newborn of newborns) {
      expect(newborn.age).toBeGreaterThanOrEqual(0);
      expect(newborn.age).toBeLessThan(DEFAULT_CONFIG.fertility.male.minAge);
      expect(newborn.age).toBeLessThan(DEFAULT_CONFIG.fertility.female.minAge);
      expect(newborn.partnerId).toBeNull();
    }
  });

  it('places every newborn inside the world', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 45);
    sim.step(30);
    const snap = sim.snapshot();
    for (const agent of snap.agents) {
      expect(agent.x).toBeGreaterThanOrEqual(0);
      expect(agent.x).toBeLessThanOrEqual(snap.worldWidth);
      expect(agent.y).toBeGreaterThanOrEqual(0);
      expect(agent.y).toBeLessThanOrEqual(snap.worldHeight);
    }
  });

  it('grows the population when fertility is high', () => {
    const sim = Simulation.init(
      config((c) => {
        c.birthChancePerYear = 0.4;
        c.union.chance = 0.6;
        c.maxAgents = 100000;
      }),
      46,
    );
    sim.step(60);
    expect(sim.agentCount).toBeGreaterThan(DEFAULT_CONFIG.startingPopulation);
  });
});

describe('capacity guardrail', () => {
  it('never exceeds maxAgents', () => {
    const cap = 260;
    const sim = Simulation.init(
      config((c) => {
        c.birthChancePerYear = 0.5;
        c.union.chance = 0.9;
        c.maxAgents = cap;
      }),
      47,
    );
    for (let year = 0; year < 80; year++) {
      sim.step(1);
      expect(sim.agentCount).toBeLessThanOrEqual(cap);
    }
  });

  it('counts suppressed births when the cap is reached', () => {
    const sim = Simulation.init(
      config((c) => {
        c.birthChancePerYear = 0.5;
        c.union.chance = 0.9;
        c.maxAgents = 260;
      }),
      47,
    );
    sim.step(80);
    const suppressed = sim
      .stats()
      .reduce((acc, s) => acc + s.suppressedBirths, 0);
    expect(suppressed).toBeGreaterThan(0);
  });

  it('flags capacity in the snapshot', () => {
    const sim = Simulation.init(
      config((c) => {
        c.birthChancePerYear = 0.5;
        c.union.chance = 0.9;
        c.maxAgents = 260;
      }),
      47,
    );
    sim.step(80);
    expect(sim.snapshot().atCapacity).toBe(true);
  });

  it('reports no suppression for a run that never reaches the cap', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 48);
    sim.step(40);
    expect(
      sim.stats().reduce((acc, s) => acc + s.suppressedBirths, 0),
    ).toBe(0);
  });
});

describe('determinism with births', () => {
  it('reproduces the same run for the same seed', () => {
    const a = Simulation.init(DEFAULT_CONFIG, 49);
    const b = Simulation.init(DEFAULT_CONFIG, 49);
    a.step(50);
    b.step(50);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.stats()).toEqual(b.stats());
  });
});
