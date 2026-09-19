import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';

describe('Rng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = new Rng(42).stream('movement');
    const b = new Rng(42).stream('movement');
    const seqA = [a.next(), a.next(), a.next()];
    const seqB = [b.next(), b.next(), b.next()];
    expect(seqA).toEqual(seqB);
  });

  it('produces different sequences for different seeds', () => {
    const a = new Rng(1).stream('movement');
    const b = new Rng(2).stream('movement');
    expect(a.next()).not.toEqual(b.next());
  });

  it('gives independent sequences to different streams', () => {
    const rng = new Rng(7);
    const movement = rng.stream('movement');
    const birth = rng.stream('birth');
    expect(movement.next()).not.toEqual(birth.next());
  });

  it('does not shift one stream when another is drawn from', () => {
    const control = new Rng(99).stream('birth');
    const expected = [control.next(), control.next()];

    const rng = new Rng(99);
    const movement = rng.stream('movement');
    const birth = rng.stream('birth');
    movement.next();
    movement.next();
    movement.next();
    const actual = [birth.next(), birth.next()];

    expect(actual).toEqual(expected);
  });

  it('returns the same stream instance for a repeated name', () => {
    const rng = new Rng(3);
    expect(rng.stream('union')).toBe(rng.stream('union'));
  });

  it('generates values in [0, 1)', () => {
    const s = new Rng(5).stream('movement');
    for (let i = 0; i < 1000; i++) {
      const v = s.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('range stays within bounds', () => {
    const s = new Rng(11).stream('movement');
    for (let i = 0; i < 1000; i++) {
      const v = s.range(10, 20);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(20);
    }
  });

  it('int stays within bounds and hits both ends', () => {
    const s = new Rng(13).stream('movement');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = s.int(0, 3);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(3);
      seen.add(v);
    }
    expect(seen).toEqual(new Set([0, 1, 2]));
  });

  it('bool respects its probability approximately', () => {
    const s = new Rng(17).stream('union');
    let hits = 0;
    for (let i = 0; i < 10000; i++) if (s.bool(0.25)) hits++;
    expect(hits / 10000).toBeGreaterThan(0.23);
    expect(hits / 10000).toBeLessThan(0.27);
  });

  it('bool(0) is always false and bool(1) is always true', () => {
    const s = new Rng(19).stream('union');
    for (let i = 0; i < 100; i++) {
      expect(s.bool(0)).toBe(false);
      expect(s.bool(1)).toBe(true);
    }
  });

  it('normal converges on its mean and standard deviation', () => {
    const s = new Rng(23).stream('lifespan');
    const n = 20000;
    const samples: number[] = [];
    for (let i = 0; i < n; i++) samples.push(s.normal(80, 12));
    const mean = samples.reduce((acc, v) => acc + v, 0) / n;
    const variance =
      samples.reduce((acc, v) => acc + (v - mean) ** 2, 0) / n;
    expect(mean).toBeGreaterThan(79);
    expect(mean).toBeLessThan(81);
    expect(Math.sqrt(variance)).toBeGreaterThan(11.4);
    expect(Math.sqrt(variance)).toBeLessThan(12.6);
  });
});
