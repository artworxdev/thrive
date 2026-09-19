export type StreamName = 'movement' | 'lifespan' | 'union' | 'birth';

/** FNV-1a over a stream name, so each stream gets a distinct sub-seed. */
function hashName(name: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and fully deterministic across platforms. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RngStream {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform float in [min, max). */
  range(min: number, max: number): number;
  /** Uniform integer in [minInclusive, maxExclusive). */
  int(minInclusive: number, maxExclusive: number): number;
  /** True with probability p. */
  bool(p: number): boolean;
  /** Normal deviate via Box-Muller, with the spare value cached. */
  normal(mean: number, stdDev: number): number;
}

class Stream implements RngStream {
  private readonly draw: () => number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.draw = mulberry32(seed);
  }

  next(): number {
    return this.draw();
  }

  range(min: number, max: number): number {
    return min + this.draw() * (max - min);
  }

  int(minInclusive: number, maxExclusive: number): number {
    const span = maxExclusive - minInclusive;
    return minInclusive + Math.floor(this.draw() * span);
  }

  bool(p: number): boolean {
    if (p <= 0) return false;
    if (p >= 1) return true;
    return this.draw() < p;
  }

  normal(mean: number, stdDev: number): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return mean + stdDev * value;
    }
    // Avoid log(0) by excluding exactly zero.
    let u = this.draw();
    while (u === 0) u = this.draw();
    const v = this.draw();
    const magnitude = Math.sqrt(-2 * Math.log(u));
    const angle = 2 * Math.PI * v;
    this.spare = magnitude * Math.sin(angle);
    return mean + stdDev * magnitude * Math.cos(angle);
  }
}

export class Rng {
  private readonly seed: number;
  private readonly streams = new Map<StreamName, RngStream>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  stream(name: StreamName): RngStream {
    let existing = this.streams.get(name);
    if (existing === undefined) {
      existing = new Stream((this.seed ^ hashName(name)) >>> 0);
      this.streams.set(name, existing);
    }
    return existing;
  }
}
