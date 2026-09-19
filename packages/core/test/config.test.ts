import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONFIG,
  validateConfig,
  deriveSubStepsPerYear,
  ConfigError,
} from '../src/config.js';
import type { SimConfig } from '../src/config.js';

function clone(): SimConfig {
  return structuredClone(DEFAULT_CONFIG);
}

describe('DEFAULT_CONFIG', () => {
  it('is valid', () => {
    expect(() => validateConfig(DEFAULT_CONFIG)).not.toThrow();
  });

  it('uses the lifespan bounds from the spec', () => {
    expect(DEFAULT_CONFIG.lifespan.min).toBe(15);
    expect(DEFAULT_CONFIG.lifespan.max).toBe(95);
  });
});

describe('validateConfig', () => {
  it('rejects a non-finite value', () => {
    const c = clone();
    c.world.width = Number.NaN;
    expect(() => validateConfig(c)).toThrow(ConfigError);
  });

  it('rejects a lifespan minimum above its maximum', () => {
    const c = clone();
    c.lifespan.min = 90;
    c.lifespan.max = 20;
    expect(() => validateConfig(c)).toThrow(/lifespan.min/);
  });

  it('rejects a gender lifespan mean outside the lifespan bounds', () => {
    const c = clone();
    c.lifespan.meanMale = 120;
    expect(() => validateConfig(c)).toThrow(/meanMale/);
  });

  it('rejects a probability outside zero to one', () => {
    const c = clone();
    c.union.chance = 1.5;
    expect(() => validateConfig(c)).toThrow(/union.chance/);
  });

  it('rejects a negative birth chance', () => {
    const c = clone();
    c.birthChancePerYear = -0.1;
    expect(() => validateConfig(c)).toThrow(/birthChancePerYear/);
  });

  it('rejects a starting population above maxAgents', () => {
    const c = clone();
    c.startingPopulation = 5000;
    c.maxAgents = 100;
    expect(() => validateConfig(c)).toThrow(/startingPopulation/);
  });

  it('rejects a fertility window that is inverted', () => {
    const c = clone();
    c.fertility.female.minAge = 50;
    c.fertility.female.maxAge = 20;
    expect(() => validateConfig(c)).toThrow(/fertility.female/);
  });

  it('rejects a world too small to hold the starting population', () => {
    const c = clone();
    c.world.width = 10;
    c.world.height = 10;
    expect(() => validateConfig(c)).toThrow(/world/);
  });

  it('rejects a non-positive agent radius', () => {
    const c = clone();
    c.agentRadius = 0;
    expect(() => validateConfig(c)).toThrow(/agentRadius/);
  });

  it('rejects an inverted speed range', () => {
    const c = clone();
    c.speed.min = 100;
    c.speed.max = 10;
    expect(() => validateConfig(c)).toThrow(/speed/);
  });
});

describe('deriveSubStepsPerYear', () => {
  it('never returns fewer than twelve sub-steps', () => {
    const c = clone();
    c.speed.min = 1;
    c.speed.max = 2;
    c.agentRadius = 50;
    expect(deriveSubStepsPerYear(c)).toBe(12);
  });

  it('returns an integer', () => {
    expect(Number.isInteger(deriveSubStepsPerYear(DEFAULT_CONFIG))).toBe(true);
  });

  it('keeps per-sub-step travel within half an agent radius', () => {
    const c = clone();
    const steps = deriveSubStepsPerYear(c);
    const travel = c.speed.max / steps;
    expect(travel).toBeLessThanOrEqual(c.agentRadius / 2);
  });

  it('increases when the maximum speed increases', () => {
    const slow = clone();
    const fast = clone();
    fast.speed.max = slow.speed.max * 4;
    expect(deriveSubStepsPerYear(fast)).toBeGreaterThan(
      deriveSubStepsPerYear(slow),
    );
  });
});
