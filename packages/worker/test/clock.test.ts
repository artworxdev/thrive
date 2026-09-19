import { describe, it, expect } from 'vitest';
import { Clock, MAX_CATCH_UP_YEARS } from '../src/clock.js';

describe('Clock', () => {
  it('converts elapsed milliseconds into years at the configured rate', () => {
    const clock = new Clock(2);
    expect(clock.advance(1000)).toBeCloseTo(0.5);
    expect(clock.advance(2000)).toBeCloseTo(1);
  });

  it('runs faster when seconds-per-year is smaller', () => {
    expect(new Clock(0.5).advance(1000)).toBeCloseTo(2);
  });

  it('reports its current speed', () => {
    const clock = new Clock(3);
    expect(clock.secondsPerYear).toBe(3);
    clock.setSpeed(7);
    expect(clock.secondsPerYear).toBe(7);
  });

  it('applies a new speed immediately', () => {
    const clock = new Clock(2);
    clock.setSpeed(1);
    expect(clock.advance(1000)).toBeCloseTo(1);
  });

  it('clamps a long stall so a backgrounded tab cannot fast-forward', () => {
    const clock = new Clock(1);
    expect(clock.advance(60_000)).toBe(MAX_CATCH_UP_YEARS);
  });

  it('returns zero for zero or negative elapsed time', () => {
    const clock = new Clock(1);
    expect(clock.advance(0)).toBe(0);
    expect(clock.advance(-100)).toBe(0);
  });

  it('rejects a non-positive speed', () => {
    expect(() => new Clock(0)).toThrow(/secondsPerYear/);
    expect(() => new Clock(1).setSpeed(-1)).toThrow(/secondsPerYear/);
  });
});
