import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { SimConfig } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import type { Union } from '../src/union.js';
import type { AgentId } from '../src/types.js';

function config(over: (c: SimConfig) => void): SimConfig {
  const c = structuredClone(DEFAULT_CONFIG);
  over(c);
  return c;
}

/**
 * Exposes the protected pieces needed to drive a union to dissolution
 * directly, without depending on the physics/RNG to produce an encounter.
 */
class TestableSimulation extends Simulation {
  static override init(config: SimConfig, seed: number): TestableSimulation {
    return new TestableSimulation(config, seed);
  }

  createUnion(a: AgentId, b: AgentId, startYear: number, durationYears: number): Union {
    const union = this.unions.create(a, b, startYear, durationYears);
    const agentA = this.byId.get(a)!;
    const agentB = this.byId.get(b)!;
    agentA.partnerId = b;
    agentB.partnerId = a;
    agentA.unionId = union.id;
    agentB.unionId = union.id;
    return union;
  }

  agent(id: AgentId) {
    return this.byId.get(id)!;
  }

  dissolveUnion(union: Union, exceptId: AgentId | null): void {
    this.dissolve(union, exceptId);
  }
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

  it('a 1-year cooldown must differ from a 0-year cooldown (pins the exact magnitude)', () => {
    // Regression test for an off-by-one in annualTick's ordering: dissolve()
    // sets cooldownRemaining = repairCooldownYears, and that used to be
    // decremented in the very same tick it was set (decrementCooldowns ran
    // after annualEvents, in the same annualTick call as the dissolutions
    // that annualEvents triggers). That silently ate one full year off
    // every cooldown, so repairCooldownYears: 1 behaved exactly like 0 — no
    // cooldown at all. A coarse 50-vs-0 comparison can't catch that,
    // because both magnitudes still "work" in the broken code, just shifted
    // by one year. Comparing 1 vs 0 is the sharpest possible check: with the
    // bug, these two configs are byte-identical runs; fixed, they must
    // diverge as soon as any union dissolves and its survivor tries to
    // re-pair within that first cooldown year.
    const withOneYearCooldown = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 1;
      }),
      29,
    );
    const withNoCooldown = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 0;
      }),
      29,
    );
    withOneYearCooldown.step(20);
    withNoCooldown.step(20);

    const unionSeries = (sim: Simulation) =>
      sim.stats().map((s) => s.activeUnions);

    expect(unionSeries(withOneYearCooldown)).not.toEqual(
      unionSeries(withNoCooldown),
    );
  });

  it('restores a released follower\'s own speed on dissolution', () => {
    // applyBodies overwrites a bonded follower's `speed` with the leader's,
    // so the pair moves as one body. Nothing ever restored it when the
    // union ended, so roughly half the population kept a borrowed speed
    // forever — a violation of "speed is constant for an agent's lifetime".
    // dissolve() must now restore `speed` from `ownSpeed` for every member
    // it releases.
    const sim = TestableSimulation.init(DEFAULT_CONFIG, 40);
    const leader = sim.agent(0);
    const follower = sim.agent(1);
    const followerOriginalSpeed = follower.speed;

    // Sanity: the two agents must start with distinct speeds, otherwise the
    // test can't distinguish "restored" from "still borrowed".
    expect(followerOriginalSpeed).not.toBe(leader.speed);

    // Simulate what applyBodies does while the pair is bonded.
    follower.speed = leader.speed;
    expect(follower.speed).not.toBe(follower.ownSpeed);

    const union = sim.createUnion(leader.id, follower.id, sim.year, 5);
    sim.dissolveUnion(union, null);

    expect(follower.speed).toBe(followerOriginalSpeed);
    expect(follower.speed).toBe(follower.ownSpeed);
    // The leader's own speed was never disturbed; restoring from ownSpeed
    // is a no-op for it, which is fine.
    expect(leader.speed).toBe(leader.ownSpeed);
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
