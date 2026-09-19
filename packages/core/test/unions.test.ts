import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { SimConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';

function config(over: (c: SimConfig) => void): SimConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

describe('union formation', () => {
  it('forms unions over time under the default config', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 21);
    sim.step(10);
    expect(sim.stats().at(-1)!.activeUnions).toBeGreaterThan(0);
  });

  it('forms no unions when the union chance is zero', () => {
    const sim = Simulation.init(
      config((c) => {
        c.union.chance = 0;
      }),
      21,
    );
    sim.step(20);
    for (const sample of sim.stats()) expect(sample.activeUnions).toBe(0);
    for (const agent of sim.snapshot().agents) {
      expect(agent.partnerId).toBeNull();
    }
  });

  it('always records partnerships reciprocally', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 22);
    sim.step(15);
    const agents = sim.snapshot().agents;
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const agent of agents) {
      if (agent.partnerId === null) continue;
      const partner = byId.get(agent.partnerId);
      expect(partner).toBeDefined();
      expect(partner!.partnerId).toBe(agent.id);
    }
  });

  it('never partners two agents of the same gender', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 23);
    sim.step(15);
    const agents = sim.snapshot().agents;
    const byId = new Map(agents.map((a) => [a.id, a]));
    for (const agent of agents) {
      if (agent.partnerId === null) continue;
      expect(byId.get(agent.partnerId)!.gender).not.toBe(agent.gender);
    }
  });

  it('keeps bonded partners at the configured bond offset', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 24);
    sim.step(12);
    const agents = sim.snapshot().agents;
    const byId = new Map(agents.map((a) => [a.id, a]));
    let checked = 0;
    for (const agent of agents) {
      if (agent.partnerId === null || agent.id > agent.partnerId) continue;
      const partner = byId.get(agent.partnerId)!;
      const separation = Math.hypot(partner.x - agent.x, partner.y - agent.y);
      // Wall clamping can shorten the offset slightly; it never exceeds it.
      expect(separation).toBeLessThanOrEqual(
        DEFAULT_CONFIG.union.bondOffset + 1e-6,
      );
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('keeps the active union count consistent with partnered agents', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 25);
    sim.step(15);
    const partnered = sim
      .snapshot()
      .agents.filter((a) => a.partnerId !== null).length;
    expect(sim.stats().at(-1)!.activeUnions * 2).toBe(partnered);
  });
});

describe('union dissolution', () => {
  it('releases both partners when the union expires', () => {
    const sim = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 2;
        c.union.repairCooldownYears = 0;
      }),
      26,
    );
    sim.step(20);
    const counts = sim.stats().map((s) => s.activeUnions);
    const peak = Math.max(...counts);
    expect(peak).toBeGreaterThan(0);
    // Short unions must dissolve, so the count falls back below its peak
    // rather than only ever growing.
    const afterPeak = counts.slice(counts.indexOf(peak) + 1);
    expect(Math.min(...afterPeak)).toBeLessThan(peak);
  });

  it('releases the survivor when a partner dies', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 27);
    sim.step(60);
    const agents = sim.snapshot().agents;
    const ids = new Set(agents.map((a) => a.id));
    // No agent may point at a partner who is no longer alive.
    for (const agent of agents) {
      if (agent.partnerId === null) continue;
      expect(ids.has(agent.partnerId)).toBe(true);
    }
  });

  it('never leaves a union referencing a dead agent', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 28);
    sim.step(80);
    const living = new Set(sim.snapshot().agents.map((a) => a.id));
    const partnered = sim
      .snapshot()
      .agents.filter((a) => a.partnerId !== null);
    for (const agent of partnered) expect(living.has(agent.partnerId!)).toBe(true);
    expect(sim.stats().at(-1)!.activeUnions * 2).toBe(partnered.length);
  });

  it('applies the re-pair cooldown after a union ends', () => {
    const withCooldown = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 50;
      }),
      29,
    );
    const withoutCooldown = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 0;
      }),
      29,
    );
    withCooldown.step(20);
    withoutCooldown.step(20);

    // Same seed, same config apart from the cooldown. If dissolve() failed
    // to set cooldownRemaining, the cooldown would have no effect at all
    // and these two runs would be identical. Comparing the magnitude of
    // active unions instead would be a coin-flip: the effect is real but
    // small (14 vs 17 union-years on this seed).
    const unionSeries = (sim: Simulation) =>
      sim.stats().map((s) => s.activeUnions);

    expect(unionSeries(withCooldown)).not.toEqual(unionSeries(withoutCooldown));
  });
});

describe('determinism with unions', () => {
  it('reproduces the same run for the same seed', () => {
    const a = Simulation.init(DEFAULT_CONFIG, 31);
    const b = Simulation.init(DEFAULT_CONFIG, 31);
    a.step(30);
    b.step(30);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.stats()).toEqual(b.stats());
  });
});
