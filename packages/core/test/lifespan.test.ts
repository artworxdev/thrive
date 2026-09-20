import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { sampleLifespan } from '../src/rules/lifespan.js';

function sample(n: number, gender: 'male' | 'female'): number[] {
  const stream = new Rng(2024).stream('lifespan');
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(sampleLifespan(stream, DEFAULT_CONFIG, gender));
  }
  return out;
}

describe('sampleLifespan', () => {
  it('always lands within the configured bounds', () => {
    for (const gender of ['male', 'female'] as const) {
      for (const value of sample(5000, gender)) {
        expect(value).toBeGreaterThanOrEqual(DEFAULT_CONFIG.lifespan.min);
        expect(value).toBeLessThanOrEqual(DEFAULT_CONFIG.lifespan.max);
      }
    }
  });

  it('converges on the configured mean for each gender', () => {
    const males = sample(20000, 'male');
    const females = sample(20000, 'female');
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // Truncation pulls the mean slightly inward, so allow a wide window.
    expect(meanOf(males)).toBeGreaterThan(DEFAULT_CONFIG.lifespan.meanMale - 4);
    expect(meanOf(males)).toBeLessThan(DEFAULT_CONFIG.lifespan.meanMale + 4);
    expect(meanOf(females)).toBeGreaterThan(
      DEFAULT_CONFIG.lifespan.meanFemale - 4,
    );
    expect(meanOf(females)).toBeLessThan(
      DEFAULT_CONFIG.lifespan.meanFemale + 4,
    );
  });

  it('gives women a higher mean lifespan than men under the default config', () => {
    const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(meanOf(sample(20000, 'female'))).toBeGreaterThan(
      meanOf(sample(20000, 'male')),
    );
  });

  it('produces spread rather than a constant', () => {
    const values = new Set(sample(500, 'male'));
    expect(values.size).toBeGreaterThan(100);
  });

  it('is deterministic for a given seed', () => {
    expect(sample(50, 'male')).toEqual(sample(50, 'male'));
  });

  it('clamps rather than looping forever when bounds are unreachable', () => {
    const stream = new Rng(5).stream('lifespan');
    const config = structuredClone(DEFAULT_CONFIG);
    // A distribution whose mass lies almost entirely outside the bounds.
    config.lifespan = {
      min: 15,
      max: 16,
      meanMale: 15.5,
      meanFemale: 15.5,
      stdDev: 40,
    };
    for (let i = 0; i < 200; i++) {
      const value = sampleLifespan(stream, config, 'male');
      expect(value).toBeGreaterThanOrEqual(15);
      expect(value).toBeLessThanOrEqual(16);
    }
  });
});
