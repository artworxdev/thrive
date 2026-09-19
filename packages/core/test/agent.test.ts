import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ageOf, createAgent, createInitialPopulation } from '../src/agent.js';

describe('createAgent', () => {
  it('starts unpartnered with no cooldown', () => {
    const agent = createAgent({
      id: 7,
      gender: 'female',
      x: 10,
      y: 20,
      birthYear: 3,
      config: DEFAULT_CONFIG,
      rng: new Rng(1),
    });
    expect(agent.id).toBe(7);
    expect(agent.partnerId).toBeNull();
    expect(agent.unionId).toBeNull();
    expect(agent.cooldownRemaining).toBe(0);
    expect(agent.birthYear).toBe(3);
  });

  it('receives a normalized direction', () => {
    const agent = createAgent({
      id: 1,
      gender: 'male',
      x: 0,
      y: 0,
      birthYear: 0,
      config: DEFAULT_CONFIG,
      rng: new Rng(2),
    });
    expect(Math.hypot(agent.dx, agent.dy)).toBeCloseTo(1);
  });

  it('receives a speed inside the configured range', () => {
    for (let seed = 0; seed < 50; seed++) {
      const agent = createAgent({
        id: 1,
        gender: 'male',
        x: 0,
        y: 0,
        birthYear: 0,
        config: DEFAULT_CONFIG,
        rng: new Rng(seed),
      });
      expect(agent.speed).toBeGreaterThanOrEqual(DEFAULT_CONFIG.speed.min);
      expect(agent.speed).toBeLessThanOrEqual(DEFAULT_CONFIG.speed.max);
    }
  });
});

describe('ageOf', () => {
  it('is the difference between the current year and the birth year', () => {
    const agent = createAgent({
      id: 1,
      gender: 'male',
      x: 0,
      y: 0,
      birthYear: -30,
      config: DEFAULT_CONFIG,
      rng: new Rng(1),
    });
    expect(ageOf(agent, 0)).toBe(30);
    expect(ageOf(agent, 10)).toBe(40);
  });
});

describe('createInitialPopulation', () => {
  it('creates exactly the configured number of agents', () => {
    const agents = createInitialPopulation(DEFAULT_CONFIG, new Rng(5));
    expect(agents).toHaveLength(DEFAULT_CONFIG.startingPopulation);
  });

  it('assigns sequential ids starting at zero', () => {
    const agents = createInitialPopulation(DEFAULT_CONFIG, new Rng(5));
    expect(agents.map((a) => a.id)).toEqual(
      agents.map((_, index) => index),
    );
  });

  it('places every agent fully inside the world', () => {
    const agents = createInitialPopulation(DEFAULT_CONFIG, new Rng(6));
    const r = DEFAULT_CONFIG.agentRadius;
    for (const agent of agents) {
      expect(agent.x).toBeGreaterThanOrEqual(r);
      expect(agent.x).toBeLessThanOrEqual(DEFAULT_CONFIG.world.width - r);
      expect(agent.y).toBeGreaterThanOrEqual(r);
      expect(agent.y).toBeLessThanOrEqual(DEFAULT_CONFIG.world.height - r);
    }
  });

  it('spreads starting ages rather than starting everyone at zero', () => {
    const agents = createInitialPopulation(DEFAULT_CONFIG, new Rng(7));
    const ages = agents.map((a) => ageOf(a, 0));
    expect(Math.min(...ages)).toBeLessThan(10);
    expect(Math.max(...ages)).toBeGreaterThan(50);
    expect(new Set(ages.map((a) => Math.floor(a / 10))).size).toBeGreaterThan(5);
  });

  it('never gives a starting age at or beyond that agent lifespan', () => {
    const agents = createInitialPopulation(DEFAULT_CONFIG, new Rng(8));
    for (const agent of agents) {
      expect(ageOf(agent, 0)).toBeLessThan(agent.lifespan);
      expect(ageOf(agent, 0)).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces roughly the configured sex ratio', () => {
    const config = structuredClone(DEFAULT_CONFIG);
    config.startingPopulation = 2000;
    const agents = createInitialPopulation(config, new Rng(9));
    const males = agents.filter((a) => a.gender === 'male').length;
    expect(males / agents.length).toBeGreaterThan(0.44);
    expect(males / agents.length).toBeLessThan(0.56);
  });

  it('is deterministic for a given seed', () => {
    const a = createInitialPopulation(DEFAULT_CONFIG, new Rng(11));
    const b = createInitialPopulation(DEFAULT_CONFIG, new Rng(11));
    expect(a).toEqual(b);
  });

  it('differs for a different seed', () => {
    const a = createInitialPopulation(DEFAULT_CONFIG, new Rng(11));
    const b = createInitialPopulation(DEFAULT_CONFIG, new Rng(12));
    expect(a).not.toEqual(b);
  });
});
