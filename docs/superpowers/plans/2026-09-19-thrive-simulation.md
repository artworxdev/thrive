# Thrive Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a seeded, reproducible population simulation where agents move, collide, age, form unions, reproduce, and die — watchable in a browser and runnable headlessly.

**Architecture:** A pure, dependency-free TypeScript simulation core with no DOM, timers, I/O, or unseeded randomness. A Web Worker owns all wall-clock time and drives the core. A canvas UI renders snapshots only. A Node CLI imports the same core for headless runs. Four npm workspace packages in one repo.

**Tech Stack:** TypeScript 5.6 (strict), Vitest, Vite, npm workspaces, Node 22, Docker + Compose.

**Spec:** `docs/superpowers/specs/2026-09-19-thrive-simulation-design.md`

## Global Constraints

- Node 22 LTS. TypeScript 5.6 with `strict: true` and `noUncheckedIndexedAccess: true`.
- `packages/core` has **zero runtime dependencies**. No `dependencies` key in its `package.json`.
- The core must never reference `window`, `document`, `setTimeout`, `setInterval`, `performance`, `Date`, `fetch`, `fs`, or `Math.random`. `Math.imul`, `Math.sqrt`, `Math.floor`, `Math.log`, `Math.cos` are fine.
- All randomness comes from `Rng` streams named exactly: `movement`, `lifespan`, `union`, `birth`.
- Agents are always iterated in ascending id order. Collision pairs are resolved in a stable, grid-order sequence.
- One simulated year is the model's time unit. Sub-steps per year are derived from config, never hardcoded, and are always an integer ≥ 12 so year boundaries land exactly.
- Default config values are given verbatim in Task 2 and must not be altered by later tasks.
- Every task ends with a passing test run and a commit.

### Deviations from the spec (deliberate, approved)

- `command(cmd)` returns a `CommandResult` rather than `void`, because `exportStats` must return data.
- Sub-steps per year are derived from `maxSpeed` and `agentRadius` rather than fixed at 1/12 year. The spec's fixed 1/12 violates its own no-tunneling rule at default speeds.
- A bonded pair is represented in physics by its lower-id member ("leader") carrying an enlarged radius that covers both members plus the bond offset. This is the concrete implementation of the spec's "single body."
- Radius lives only on `SimConfig.agentRadius`, not as a per-agent field. The spec lists it among the agent's fields but also states it is uniform across all agents; storing it once avoids a value that could drift per agent while claiming to be uniform.

---

## File Structure

```
package.json                       npm workspaces root, shared scripts
tsconfig.base.json                 strict compiler options, shared
vitest.config.ts                   test discovery across workspaces
.gitignore

packages/core/                     pure simulation, zero runtime deps
  package.json
  tsconfig.json
  src/
    index.ts                       public barrel: Simulation, types, config
    types.ts                       Gender, ids, Snapshot, StatsSample, Command
    config.ts                      SimConfig, DEFAULT_CONFIG, validateConfig,
                                   deriveSubStepsPerYear
    rng.ts                         Rng with named independent streams
    grid.ts                        SpatialGrid broad phase
    physics.ts                     movement, wall bounce, collision, encounters
    agent.ts                       Agent entity + initial population builder
    union.ts                       Union entity + registry
    rules/lifespan.ts              truncated-normal lifespan sampling
    rules/pairing.ts               union eligibility + formation
    rules/birth.ts                 annual birth roll + offspring construction
    stats.ts                       StatsRecorder, CSV/JSON serialization
    simulation.ts                  Simulation: step, snapshot, stats, command
  test/                            one file per src module

packages/worker/                   the only place wall-clock time exists
  package.json
  src/protocol.ts                  ToWorker / FromWorker message unions
  src/clock.ts                     pure elapsed-ms to years conversion
  src/worker.ts                    worker entry, owns a Simulation
  test/clock.test.ts

packages/ui/                       browser app, reads snapshots only
  package.json
  index.html
  vite.config.ts
  src/main.ts                      wiring
  src/simClient.ts                 main-thread wrapper around the worker
  src/viewport.ts                  world to screen mapping
  src/renderer.ts                  canvas drawing
  src/chart.ts                     population-over-time line chart
  src/controls.ts                  control panel + config editor
  src/statsPanel.ts                live numbers
  src/styles.css
  test/viewport.test.ts

packages/cli/                      headless runner
  package.json
  src/args.ts                      argument parsing
  src/index.ts                     entry point
  test/args.test.ts

docker/Dockerfile.web
docker/Dockerfile.cli
docker-compose.yml
```

Responsibility boundaries: `physics.ts` knows nothing about gender, age, or unions — it emits anonymous encounter pairs. `rules/` knows nothing about the grid or collision math. `simulation.ts` is the only module that wires physics to rules. `stats.ts` is written once and consumed by both the UI and the CLI so their output shapes cannot drift.

---

## Task 1: Repository scaffolding and the seeded RNG

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`
- Create: `packages/core/src/rng.ts`
- Test: `packages/core/test/rng.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `class Rng { constructor(seed: number); stream(name: StreamName): RngStream }` and `interface RngStream { next(): number; range(min: number, max: number): number; int(minInclusive: number, maxExclusive: number): number; bool(p: number): boolean; normal(mean: number, stdDev: number): number }`, `type StreamName = 'movement' | 'lifespan' | 'union' | 'birth'`

- [ ] **Step 1: Create the workspace scaffolding**

`package.json`:

```json
{
  "name": "thrive",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*"],
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b packages/core packages/worker packages/ui packages/cli"
  },
  "devDependencies": {
    "typescript": "^5.6.3",
    "vitest": "^2.1.4"
  }
}
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "exactOptionalPropertyTypes": false,
    "declaration": true,
    "composite": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    environment: 'node',
  },
});
```

`.gitignore` — append to the existing file so it reads:

```
node_modules/
dist/
.DS_Store
*.log
*.tsbuildinfo
```

`packages/core/package.json` — note the deliberate absence of a `dependencies` key:

```json
{
  "name": "@thrive/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "exports": { ".": "./src/index.ts" }
}
```

`packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

Then run `npm install`.

- [ ] **Step 2: Write the failing test**

`packages/core/test/rng.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/rng.test.ts`
Expected: FAIL — cannot resolve `../src/rng.js`.

- [ ] **Step 4: Implement the RNG**

`packages/core/src/rng.ts`:

```ts
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
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/rng.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.base.json vitest.config.ts .gitignore package-lock.json packages/core
git commit -m "feat(core): workspace scaffolding and seeded multi-stream RNG"
```

---

## Task 2: Types, configuration, and validation

**Files:**
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/config.ts`
- Test: `packages/core/test/config.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1
- Produces: `SimConfig`, `DEFAULT_CONFIG`, `validateConfig(config: SimConfig): void` (throws `ConfigError`), `deriveSubStepsPerYear(config: SimConfig): number`, and the shared types `Gender`, `AgentId`, `UnionId`, `AgentSnapshot`, `Snapshot`, `StatsSample`, `StatsSeries`, `Command`, `CommandResult`.

- [ ] **Step 1: Write the failing test**

`packages/core/test/config.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: FAIL — cannot resolve `../src/config.js`.

- [ ] **Step 3: Write the shared types**

`packages/core/src/types.ts`:

```ts
export type Gender = 'male' | 'female';
export type AgentId = number;
export type UnionId = number;

/** One agent as the renderer sees it. Flat and transferable. */
export interface AgentSnapshot {
  id: AgentId;
  gender: Gender;
  x: number;
  y: number;
  age: number;
  partnerId: AgentId | null;
}

/** Everything the renderer needs for one frame. Never contains live objects. */
export interface Snapshot {
  year: number;
  agents: AgentSnapshot[];
  worldWidth: number;
  worldHeight: number;
  agentRadius: number;
  extinct: boolean;
  atCapacity: boolean;
}

/** One sample, recorded at each integer year boundary. */
export interface StatsSample {
  year: number;
  population: number;
  males: number;
  females: number;
  births: number;
  deaths: number;
  activeUnions: number;
  meanAge: number;
  /** Ten decade buckets: 0-9, 10-19, ... 80-89, 90+. */
  ageBuckets: number[];
  suppressedBirths: number;
}

export type StatsSeries = StatsSample[];

export type Command =
  | { type: 'reset'; seed: number }
  | { type: 'runToYear'; year: number }
  | { type: 'exportStats'; format: 'csv' | 'json' };

export type CommandResult =
  | { type: 'ok' }
  | { type: 'stats'; format: 'csv' | 'json'; data: string };
```

- [ ] **Step 4: Write the configuration module**

`packages/core/src/config.ts`:

```ts
export interface AgeWindow {
  minAge: number;
  maxAge: number;
}

export interface SimConfig {
  world: { width: number; height: number };
  startingPopulation: number;
  maxAgents: number;
  /** Probability that a newborn is male. */
  sexRatioMale: number;
  /** Uniform for all agents: both the drawn size and the collision distance. */
  agentRadius: number;
  /** World units travelled per year. */
  speed: { min: number; max: number };
  lifespan: {
    min: number;
    max: number;
    meanMale: number;
    meanFemale: number;
    stdDev: number;
  };
  fertility: { male: AgeWindow; female: AgeWindow };
  union: {
    /** Probability a qualifying encounter becomes a union. */
    chance: number;
    minDurationYears: number;
    maxDurationYears: number;
    repairCooldownYears: number;
    /** Distance held between bonded partners. */
    bondOffset: number;
  };
  birthChancePerYear: number;
}

export const DEFAULT_CONFIG: SimConfig = {
  world: { width: 1000, height: 600 },
  startingPopulation: 200,
  maxAgents: 2000,
  sexRatioMale: 0.5,
  agentRadius: 4,
  speed: { min: 20, max: 60 },
  lifespan: {
    min: 15,
    max: 95,
    meanMale: 76,
    meanFemale: 81,
    stdDev: 12,
  },
  fertility: {
    male: { minAge: 18, maxAge: 60 },
    female: { minAge: 18, maxAge: 45 },
  },
  union: {
    chance: 0.25,
    minDurationYears: 5,
    maxDurationYears: 40,
    repairCooldownYears: 2,
    bondOffset: 9,
  },
  birthChancePerYear: 0.12,
};

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function requireFinite(value: number, path: string): void {
  if (!Number.isFinite(value)) {
    throw new ConfigError(path + ' must be a finite number, got ' + String(value));
  }
}

function requirePositive(value: number, path: string): void {
  requireFinite(value, path);
  if (value <= 0) {
    throw new ConfigError(path + ' must be greater than zero, got ' + String(value));
  }
}

function requireProbability(value: number, path: string): void {
  requireFinite(value, path);
  if (value < 0 || value > 1) {
    throw new ConfigError(path + ' must be between 0 and 1, got ' + String(value));
  }
}

function requireWindow(window: AgeWindow, path: string): void {
  requireFinite(window.minAge, path + '.minAge');
  requireFinite(window.maxAge, path + '.maxAge');
  if (window.minAge < 0) {
    throw new ConfigError(path + '.minAge must not be negative');
  }
  if (window.minAge >= window.maxAge) {
    throw new ConfigError(path + ' window is inverted: minAge must be below maxAge');
  }
}

export function validateConfig(config: SimConfig): void {
  requirePositive(config.world.width, 'world.width');
  requirePositive(config.world.height, 'world.height');
  requirePositive(config.agentRadius, 'agentRadius');
  requireProbability(config.sexRatioMale, 'sexRatioMale');
  requireProbability(config.union.chance, 'union.chance');
  requireProbability(config.birthChancePerYear, 'birthChancePerYear');

  requirePositive(config.speed.min, 'speed.min');
  requirePositive(config.speed.max, 'speed.max');
  if (config.speed.min > config.speed.max) {
    throw new ConfigError('speed.min must not exceed speed.max');
  }

  requirePositive(config.lifespan.min, 'lifespan.min');
  requirePositive(config.lifespan.max, 'lifespan.max');
  if (config.lifespan.min >= config.lifespan.max) {
    throw new ConfigError('lifespan.min must be below lifespan.max');
  }
  requirePositive(config.lifespan.stdDev, 'lifespan.stdDev');
  for (const key of ['meanMale', 'meanFemale'] as const) {
    const mean = config.lifespan[key];
    requireFinite(mean, 'lifespan.' + key);
    if (mean < config.lifespan.min || mean > config.lifespan.max) {
      throw new ConfigError(
        'lifespan.' + key + ' must lie within the lifespan bounds',
      );
    }
  }

  requireWindow(config.fertility.male, 'fertility.male');
  requireWindow(config.fertility.female, 'fertility.female');

  requirePositive(config.startingPopulation, 'startingPopulation');
  requirePositive(config.maxAgents, 'maxAgents');
  if (config.startingPopulation > config.maxAgents) {
    throw new ConfigError('startingPopulation must not exceed maxAgents');
  }

  requirePositive(config.union.minDurationYears, 'union.minDurationYears');
  if (config.union.minDurationYears > config.union.maxDurationYears) {
    throw new ConfigError(
      'union.minDurationYears must not exceed union.maxDurationYears',
    );
  }
  requireFinite(config.union.repairCooldownYears, 'union.repairCooldownYears');
  if (config.union.repairCooldownYears < 0) {
    throw new ConfigError('union.repairCooldownYears must not be negative');
  }
  requirePositive(config.union.bondOffset, 'union.bondOffset');

  // The world must physically hold the starting population without forcing
  // overlap at initialization. One agent needs roughly a 2r by 2r cell.
  const cellArea = (2 * config.agentRadius) ** 2;
  const capacity = (config.world.width * config.world.height) / cellArea;
  if (config.startingPopulation > capacity) {
    throw new ConfigError(
      'world is too small to hold startingPopulation without overlap',
    );
  }
}

/**
 * Sub-steps per simulated year. Chosen so that no body travels more than half
 * an agent radius per sub-step, which is what prevents tunnelling. Always an
 * integer, so integer year boundaries land exactly on a sub-step boundary.
 */
export function deriveSubStepsPerYear(config: SimConfig): number {
  const maxTravelPerStep = config.agentRadius / 2;
  const required = Math.ceil(config.speed.max / maxTravelPerStep);
  return Math.max(12, required);
}

export type { SimConfig as Config };
```

- [ ] **Step 5: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/config.test.ts`
Expected: PASS, 16 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/config.ts packages/core/test/config.test.ts
git commit -m "feat(core): shared types, default config, validation, sub-step derivation"
```

---

## Task 3: Lifespan sampling

**Files:**
- Create: `packages/core/src/rules/lifespan.ts`
- Test: `packages/core/test/lifespan.test.ts`

**Interfaces:**
- Consumes: `RngStream` (Task 1), `SimConfig`, `Gender` (Task 2)
- Produces: `sampleLifespan(stream: RngStream, config: SimConfig, gender: Gender): number`

- [ ] **Step 1: Write the failing test**

`packages/core/test/lifespan.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/lifespan.test.ts`
Expected: FAIL — cannot resolve `../src/rules/lifespan.js`.

- [ ] **Step 3: Implement lifespan sampling**

`packages/core/src/rules/lifespan.ts`:

```ts
import type { RngStream } from '../rng.js';
import type { SimConfig } from '../config.js';
import type { Gender } from '../types.js';

/** Rejection attempts before falling back to clamping. */
const MAX_ATTEMPTS = 32;

/**
 * Truncated normal lifespan. Rejection sampling keeps the distribution shape
 * honest for sane configurations; the clamp fallback guarantees termination
 * for configurations whose mass lies outside the bounds.
 */
export function sampleLifespan(
  stream: RngStream,
  config: SimConfig,
  gender: Gender,
): number {
  const { min, max, stdDev } = config.lifespan;
  const mean =
    gender === 'male' ? config.lifespan.meanMale : config.lifespan.meanFemale;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const value = stream.normal(mean, stdDev);
    if (value >= min && value <= max) return value;
  }
  return Math.min(max, Math.max(min, stream.normal(mean, stdDev)));
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/lifespan.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/rules/lifespan.ts packages/core/test/lifespan.test.ts
git commit -m "feat(core): truncated-normal lifespan sampling per gender"
```

---

## Task 4: Spatial grid broad phase

**Files:**
- Create: `packages/core/src/grid.ts`
- Test: `packages/core/test/grid.test.ts`

**Interfaces:**
- Consumes: `AgentId` (Task 2)
- Produces: `class SpatialGrid { constructor(width: number, height: number, cellSize: number); clear(): void; insert(id: AgentId, x: number, y: number): void; candidatePairs(): Array<[AgentId, AgentId]> }`

Each unordered pair is emitted at most once, always as `[lower, higher]`, in a stable grid-scan order. Callers insert in ascending id order.

- [ ] **Step 1: Write the failing test**

`packages/core/test/grid.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/grid.js';

describe('SpatialGrid', () => {
  it('finds a pair sharing one cell', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 6, 6);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in horizontally adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 9, 5);
    grid.insert(2, 11, 5);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in vertically adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 9);
    grid.insert(2, 5, 11);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in diagonally adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 9, 9);
    grid.insert(2, 11, 11);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('ignores a pair that is cells apart', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 85, 85);
    expect(grid.candidatePairs()).toEqual([]);
  });

  it('never emits the same unordered pair twice', () => {
    const grid = new SpatialGrid(100, 100, 10);
    for (let i = 0; i < 20; i++) grid.insert(i, 50 + (i % 3), 50 + (i % 2));
    const pairs = grid.candidatePairs();
    const keys = pairs.map(([a, b]) => a + ':' + b);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('always orders a pair with the lower id first', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(9, 5, 5);
    grid.insert(3, 6, 6);
    for (const [a, b] of grid.candidatePairs()) expect(a).toBeLessThan(b);
  });

  it('produces the same order for the same insertions', () => {
    const build = () => {
      const grid = new SpatialGrid(100, 100, 10);
      for (let i = 0; i < 50; i++) {
        grid.insert(i, (i * 7) % 100, (i * 13) % 100);
      }
      return grid.candidatePairs();
    };
    expect(build()).toEqual(build());
  });

  it('clear removes all occupants', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 6, 6);
    grid.clear();
    expect(grid.candidatePairs()).toEqual([]);
  });

  it('clamps positions on or beyond the boundary into the grid', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 100, 100);
    grid.insert(2, 99.9, 99.9);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds every pair among coincident points', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 50, 50);
    grid.insert(2, 50, 50);
    grid.insert(3, 50, 50);
    expect(grid.candidatePairs()).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/grid.test.ts`
Expected: FAIL — cannot resolve `../src/grid.js`.

- [ ] **Step 3: Implement the grid**

`packages/core/src/grid.ts`:

```ts
import type { AgentId } from './types.js';

/**
 * Uniform grid broad phase. Each cell is checked against itself and four of
 * its eight neighbours (E, SE, S, SW), which visits every adjacent cell pair
 * exactly once and so needs no de-duplication pass.
 */
export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly cells: AgentId[][];

  constructor(width: number, height: number, cellSize: number) {
    if (cellSize <= 0) throw new Error('cellSize must be greater than zero');
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0;
  }

  insert(id: AgentId, x: number, y: number): void {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    const cell = this.cells[row * this.cols + col];
    if (cell !== undefined) cell.push(id);
  }

  candidatePairs(): Array<[AgentId, AgentId]> {
    const pairs: Array<[AgentId, AgentId]> = [];
    // E, SE, S, SW — the half-neighbourhood.
    const neighbours: Array<[number, number]> = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
    ];

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const here = this.cells[row * this.cols + col];
        if (here === undefined || here.length === 0) continue;

        for (let i = 0; i < here.length; i++) {
          for (let j = i + 1; j < here.length; j++) {
            pairs.push(orderPair(here[i]!, here[j]!));
          }
        }

        for (const [dc, dr] of neighbours) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          const other = this.cells[nr * this.cols + nc];
          if (other === undefined || other.length === 0) continue;
          for (const a of here) {
            for (const b of other) pairs.push(orderPair(a, b));
          }
        }
      }
    }
    return pairs;
  }
}

function orderPair(a: AgentId, b: AgentId): [AgentId, AgentId] {
  return a < b ? [a, b] : [b, a];
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/grid.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/grid.ts packages/core/test/grid.test.ts
git commit -m "feat(core): uniform spatial grid broad phase"
```

---

## Task 5: Physics — movement, walls, collisions, encounters

**Files:**
- Create: `packages/core/src/physics.ts`
- Test: `packages/core/test/physics.test.ts`

**Interfaces:**
- Consumes: `SpatialGrid` (Task 4), `AgentId` (Task 2)
- Produces:
  - `interface PhysicsBody { agentId: AgentId; x: number; y: number; dx: number; dy: number; speed: number; radius: number }`
  - `interface WorldBounds { width: number; height: number }`
  - `advance(body: PhysicsBody, dt: number): void`
  - `bounceWalls(body: PhysicsBody, world: WorldBounds): void`
  - `resolveCollision(a: PhysicsBody, b: PhysicsBody): boolean`
  - `stepBodies(bodies: PhysicsBody[], world: WorldBounds, grid: SpatialGrid, dt: number): Array<[AgentId, AgentId]>`

`resolveCollision` returns whether the bodies were touching. `stepBodies` returns the encounter pairs produced this sub-step. Physics knows nothing about gender, age, or unions.

- [ ] **Step 1: Write the failing test**

`packages/core/test/physics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/grid.js';
import {
  advance,
  bounceWalls,
  resolveCollision,
  stepBodies,
} from '../src/physics.js';
import type { PhysicsBody } from '../src/physics.js';

function body(over: Partial<PhysicsBody> = {}): PhysicsBody {
  return {
    agentId: 1,
    x: 50,
    y: 50,
    dx: 1,
    dy: 0,
    speed: 10,
    radius: 4,
    ...over,
  };
}

const world = { width: 100, height: 100 };

describe('advance', () => {
  it('moves along the direction by speed times dt', () => {
    const b = body({ x: 10, y: 10, dx: 1, dy: 0, speed: 20 });
    advance(b, 0.5);
    expect(b.x).toBeCloseTo(20);
    expect(b.y).toBeCloseTo(10);
  });

  it('moves diagonally on a normalized direction', () => {
    const k = Math.SQRT1_2;
    const b = body({ x: 0, y: 0, dx: k, dy: k, speed: 10 });
    advance(b, 1);
    expect(Math.hypot(b.x, b.y)).toBeCloseTo(10);
  });
});

describe('bounceWalls', () => {
  it('flips horizontal direction at the right wall and stays inside', () => {
    const b = body({ x: 99, y: 50, dx: 1, dy: 0, radius: 4 });
    bounceWalls(b, world);
    expect(b.dx).toBe(-1);
    expect(b.x).toBeLessThanOrEqual(96);
  });

  it('flips horizontal direction at the left wall', () => {
    const b = body({ x: 1, y: 50, dx: -1, dy: 0, radius: 4 });
    bounceWalls(b, world);
    expect(b.dx).toBe(1);
    expect(b.x).toBeGreaterThanOrEqual(4);
  });

  it('flips vertical direction at the bottom wall', () => {
    const b = body({ x: 50, y: 99, dx: 0, dy: 1, radius: 4 });
    bounceWalls(b, world);
    expect(b.dy).toBe(-1);
    expect(b.y).toBeLessThanOrEqual(96);
  });

  it('flips vertical direction at the top wall', () => {
    const b = body({ x: 50, y: 1, dx: 0, dy: -1, radius: 4 });
    bounceWalls(b, world);
    expect(b.dy).toBe(1);
    expect(b.y).toBeGreaterThanOrEqual(4);
  });

  it('handles a corner by flipping both components', () => {
    const b = body({ x: 99, y: 99, dx: 1, dy: 1, radius: 4 });
    bounceWalls(b, world);
    expect(b.dx).toBe(-1);
    expect(b.dy).toBe(-1);
  });

  it('leaves an interior body untouched', () => {
    const b = body({ x: 50, y: 50, dx: 1, dy: 0 });
    bounceWalls(b, world);
    expect(b.x).toBe(50);
    expect(b.dx).toBe(1);
  });
});

describe('resolveCollision', () => {
  it('reports no contact when the bodies are apart', () => {
    const a = body({ agentId: 1, x: 0, y: 0 });
    const b = body({ agentId: 2, x: 50, y: 0 });
    expect(resolveCollision(a, b)).toBe(false);
  });

  it('reverses two bodies meeting head on', () => {
    const a = body({ agentId: 1, x: 0, y: 0, dx: 1, dy: 0 });
    const b = body({ agentId: 2, x: 7, y: 0, dx: -1, dy: 0 });
    expect(resolveCollision(a, b)).toBe(true);
    expect(a.dx).toBeCloseTo(-1);
    expect(b.dx).toBeCloseTo(1);
  });

  it('preserves each body its own speed', () => {
    const a = body({ agentId: 1, x: 0, y: 0, dx: 1, dy: 0, speed: 10 });
    const b = body({ agentId: 2, x: 6, y: 1, dx: -1, dy: 0, speed: 40 });
    resolveCollision(a, b);
    expect(a.speed).toBe(10);
    expect(b.speed).toBe(40);
    expect(Math.hypot(a.dx, a.dy)).toBeCloseTo(1);
    expect(Math.hypot(b.dx, b.dy)).toBeCloseTo(1);
  });

  it('separates overlapping bodies so they no longer overlap', () => {
    const a = body({ agentId: 1, x: 0, y: 0, dx: 1, dy: 0 });
    const b = body({ agentId: 2, x: 2, y: 0, dx: -1, dy: 0 });
    resolveCollision(a, b);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThanOrEqual(
      a.radius + b.radius - 1e-9,
    );
  });

  it('does not redirect bodies that are already separating', () => {
    const a = body({ agentId: 1, x: 0, y: 0, dx: -1, dy: 0 });
    const b = body({ agentId: 2, x: 6, y: 0, dx: 1, dy: 0 });
    resolveCollision(a, b);
    expect(a.dx).toBeCloseTo(-1);
    expect(b.dx).toBeCloseTo(1);
  });

  it('uses a deterministic normal for exactly coincident bodies', () => {
    const a = body({ agentId: 1, x: 10, y: 10, dx: 1, dy: 0 });
    const b = body({ agentId: 2, x: 10, y: 10, dx: 1, dy: 0 });
    expect(resolveCollision(a, b)).toBe(true);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0);
    expect(Number.isFinite(a.dx)).toBe(true);
    expect(Number.isFinite(b.dx)).toBe(true);
  });
});

describe('stepBodies', () => {
  it('emits an encounter for bodies that touch', () => {
    const grid = new SpatialGrid(100, 100, 8);
    const a = body({ agentId: 1, x: 40, y: 50, dx: 1, dy: 0, speed: 10 });
    const b = body({ agentId: 2, x: 46, y: 50, dx: -1, dy: 0, speed: 10 });
    const encounters = stepBodies([a, b], world, grid, 0.05);
    expect(encounters).toEqual([[1, 2]]);
  });

  it('emits nothing for distant bodies', () => {
    const grid = new SpatialGrid(100, 100, 8);
    const a = body({ agentId: 1, x: 10, y: 10, dx: 0, dy: 0, speed: 0 });
    const b = body({ agentId: 2, x: 90, y: 90, dx: 0, dy: 0, speed: 0 });
    expect(stepBodies([a, b], world, grid, 0.05)).toEqual([]);
  });

  it('keeps every body inside the world', () => {
    const grid = new SpatialGrid(100, 100, 8);
    const bodies: PhysicsBody[] = [];
    for (let i = 0; i < 40; i++) {
      bodies.push(
        body({
          agentId: i,
          x: (i * 13) % 100,
          y: (i * 29) % 100,
          dx: i % 2 === 0 ? 1 : -1,
          dy: i % 3 === 0 ? 1 : -1,
          speed: 60,
        }),
      );
    }
    for (let step = 0; step < 200; step++) {
      stepBodies(bodies, world, grid, 1 / 30);
    }
    for (const b of bodies) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x).toBeLessThanOrEqual(100);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(100);
      expect(Number.isFinite(b.x)).toBe(true);
    }
  });

  it('is deterministic across identical runs', () => {
    const run = () => {
      const grid = new SpatialGrid(100, 100, 8);
      const bodies: PhysicsBody[] = [];
      for (let i = 0; i < 30; i++) {
        bodies.push(
          body({
            agentId: i,
            x: (i * 7) % 100,
            y: (i * 11) % 100,
            dx: Math.SQRT1_2,
            dy: Math.SQRT1_2,
            speed: 30,
          }),
        );
      }
      const all: Array<[number, number]> = [];
      for (let step = 0; step < 50; step++) {
        all.push(...stepBodies(bodies, world, grid, 1 / 30));
      }
      return { all, bodies };
    };
    const first = run();
    const second = run();
    expect(first.all).toEqual(second.all);
    expect(first.bodies.map((b) => b.x)).toEqual(second.bodies.map((b) => b.x));
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/physics.test.ts`
Expected: FAIL — cannot resolve `../src/physics.js`.

- [ ] **Step 3: Implement physics**

`packages/core/src/physics.ts`:

```ts
import type { AgentId } from './types.js';
import type { SpatialGrid } from './grid.js';

/**
 * A movable body. One solo agent is one body; a bonded pair is one body
 * represented by its leader with an enlarged radius. Physics never looks at
 * gender, age, or union state.
 */
export interface PhysicsBody {
  agentId: AgentId;
  x: number;
  y: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  /** World units per year. */
  speed: number;
  radius: number;
}

export interface WorldBounds {
  width: number;
  height: number;
}

export function advance(body: PhysicsBody, dt: number): void {
  body.x += body.dx * body.speed * dt;
  body.y += body.dy * body.speed * dt;
}

export function bounceWalls(body: PhysicsBody, world: WorldBounds): void {
  const r = body.radius;
  if (body.x < r) {
    body.x = r;
    body.dx = Math.abs(body.dx);
  } else if (body.x > world.width - r) {
    body.x = world.width - r;
    body.dx = -Math.abs(body.dx);
  }
  if (body.y < r) {
    body.y = r;
    body.dy = Math.abs(body.dy);
  } else if (body.y > world.height - r) {
    body.y = world.height - r;
    body.dy = -Math.abs(body.dy);
  }
}

/**
 * Mirrors each direction about the line of centres and separates any overlap.
 * Each body keeps its own speed — no momentum exchange, per the design.
 * Returns true when the bodies were in contact.
 */
export function resolveCollision(a: PhysicsBody, b: PhysicsBody): boolean {
  const touchDistance = a.radius + b.radius;
  let nx = b.x - a.x;
  let ny = b.y - a.y;
  let distance = Math.hypot(nx, ny);

  if (distance > touchDistance) return false;

  if (distance === 0) {
    // Deterministic fallback so coincident bodies never produce NaN.
    nx = 1;
    ny = 0;
    distance = 1e-6;
  } else {
    nx /= distance;
    ny /= distance;
  }

  // Separate, half the overlap each.
  const overlap = touchDistance - distance;
  if (overlap > 0) {
    const shift = overlap / 2;
    a.x -= nx * shift;
    a.y -= ny * shift;
    b.x += nx * shift;
    b.y += ny * shift;
  }

  // Reflect only the body that is closing on the other, so contacts that are
  // already separating do not stick.
  const aClosing = a.dx * nx + a.dy * ny;
  if (aClosing > 0) {
    a.dx -= 2 * aClosing * nx;
    a.dy -= 2 * aClosing * ny;
  }
  const bClosing = b.dx * -nx + b.dy * -ny;
  if (bClosing > 0) {
    b.dx -= 2 * bClosing * -nx;
    b.dy -= 2 * bClosing * -ny;
  }

  return true;
}

/**
 * One sub-step: move, bounce off walls, then resolve contacts found through
 * the grid. Bodies must arrive in ascending agentId order; the returned
 * encounters follow the grid's stable scan order.
 */
export function stepBodies(
  bodies: PhysicsBody[],
  world: WorldBounds,
  grid: SpatialGrid,
  dt: number,
): Array<[AgentId, AgentId]> {
  const byId = new Map<AgentId, PhysicsBody>();

  grid.clear();
  for (const body of bodies) {
    advance(body, dt);
    bounceWalls(body, world);
    grid.insert(body.agentId, body.x, body.y);
    byId.set(body.agentId, body);
  }

  const encounters: Array<[AgentId, AgentId]> = [];
  for (const [idA, idB] of grid.candidatePairs()) {
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (a === undefined || b === undefined) continue;
    if (resolveCollision(a, b)) encounters.push([idA, idB]);
  }
  return encounters;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/physics.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/physics.ts packages/core/test/physics.test.ts
git commit -m "feat(core): movement, wall bounce, collision response, encounters"
```

---

## Task 6: Agent entity and initial population

**Files:**
- Create: `packages/core/src/agent.ts`
- Test: `packages/core/test/agent.test.ts`

**Interfaces:**
- Consumes: `Rng` (Task 1), `SimConfig` (Task 2), `sampleLifespan` (Task 3)
- Produces:
  - `interface Agent { id: AgentId; gender: Gender; x: number; y: number; dx: number; dy: number; speed: number; birthYear: number; lifespan: number; partnerId: AgentId | null; unionId: UnionId | null; cooldownRemaining: number }`
  - `ageOf(agent: Agent, year: number): number`
  - `createAgent(params: { id: AgentId; gender: Gender; x: number; y: number; birthYear: number; config: SimConfig; rng: Rng }): Agent`
  - `createInitialPopulation(config: SimConfig, rng: Rng): Agent[]`

- [ ] **Step 1: Write the failing test**

`packages/core/test/agent.test.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/agent.test.ts`
Expected: FAIL — cannot resolve `../src/agent.js`.

- [ ] **Step 3: Implement the agent module**

`packages/core/src/agent.ts`:

```ts
import type { AgentId, Gender, UnionId } from './types.js';
import type { SimConfig } from './config.js';
import type { Rng } from './rng.js';
import { sampleLifespan } from './rules/lifespan.js';

export interface Agent {
  id: AgentId;
  gender: Gender;
  x: number;
  y: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  /** World units per year. */
  speed: number;
  /** May be negative for the initial population, which starts mid-life. */
  birthYear: number;
  lifespan: number;
  partnerId: AgentId | null;
  unionId: UnionId | null;
  /** Years remaining before this agent may form a new union. */
  cooldownRemaining: number;
}

export function ageOf(agent: Agent, year: number): number {
  return year - agent.birthYear;
}

export function createAgent(params: {
  id: AgentId;
  gender: Gender;
  x: number;
  y: number;
  birthYear: number;
  config: SimConfig;
  rng: Rng;
}): Agent {
  const { id, gender, x, y, birthYear, config, rng } = params;
  const movement = rng.stream('movement');
  const angle = movement.range(0, Math.PI * 2);

  return {
    id,
    gender,
    x,
    y,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    speed: movement.range(config.speed.min, config.speed.max),
    birthYear,
    lifespan: sampleLifespan(rng.stream('lifespan'), config, gender),
    partnerId: null,
    unionId: null,
    cooldownRemaining: 0,
  };
}

/**
 * Builds the year-zero population. Each agent gets a lifespan, then a starting
 * age drawn uniformly from [0, lifespan) — starting everyone at age zero would
 * create one synchronized cohort that dies off in a single wave, which is an
 * initialization artifact rather than a property of the parameters.
 */
export function createInitialPopulation(
  config: SimConfig,
  rng: Rng,
): Agent[] {
  const movement = rng.stream('movement');
  const birth = rng.stream('birth');
  const lifespanStream = rng.stream('lifespan');
  const r = config.agentRadius;

  const agents: Agent[] = [];
  for (let id = 0; id < config.startingPopulation; id++) {
    const gender: Gender = birth.bool(config.sexRatioMale) ? 'male' : 'female';
    const agent = createAgent({
      id,
      gender,
      x: movement.range(r, config.world.width - r),
      y: movement.range(r, config.world.height - r),
      birthYear: 0,
      config,
      rng,
    });
    const startingAge = lifespanStream.range(0, agent.lifespan);
    agent.birthYear = -startingAge;
    agents.push(agent);
  }
  return agents;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/agent.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/agent.ts packages/core/test/agent.test.ts
git commit -m "feat(core): agent entity and staggered initial population"
```

---

## Task 7: Statistics recording and serialization

**Files:**
- Create: `packages/core/src/stats.ts`
- Test: `packages/core/test/stats.test.ts`

**Interfaces:**
- Consumes: `Agent`, `ageOf` (Task 6), `StatsSample`, `StatsSeries` (Task 2)
- Produces:
  - `computeSample(params: { year: number; agents: Agent[]; activeUnions: number; births: number; deaths: number; suppressedBirths: number }): StatsSample`
  - `class StatsRecorder { record(sample: StatsSample): void; series(): StatsSeries; latest(): StatsSample | null }`
  - `toCsv(series: StatsSeries): string`
  - `toJson(series: StatsSeries): string`
  - `STATS_CSV_HEADER: string`

This module is the single source of the stats shape. The UI and the CLI both import it, so their output cannot drift apart.

- [ ] **Step 1: Write the failing test**

`packages/core/test/stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createAgent } from '../src/agent.js';
import type { Agent } from '../src/agent.js';
import {
  computeSample,
  StatsRecorder,
  toCsv,
  toJson,
  STATS_CSV_HEADER,
} from '../src/stats.js';

function agentAged(id: number, gender: 'male' | 'female', age: number): Agent {
  return createAgent({
    id,
    gender,
    x: 0,
    y: 0,
    birthYear: -age,
    config: DEFAULT_CONFIG,
    rng: new Rng(id + 1),
  });
}

describe('computeSample', () => {
  const agents = [
    agentAged(0, 'male', 10),
    agentAged(1, 'male', 30),
    agentAged(2, 'female', 50),
    agentAged(3, 'female', 95),
  ];
  const sample = computeSample({
    year: 0,
    agents,
    activeUnions: 1,
    births: 2,
    deaths: 3,
    suppressedBirths: 4,
  });

  it('counts the population and each gender', () => {
    expect(sample.population).toBe(4);
    expect(sample.males).toBe(2);
    expect(sample.females).toBe(2);
  });

  it('carries the event counts through', () => {
    expect(sample.births).toBe(2);
    expect(sample.deaths).toBe(3);
    expect(sample.activeUnions).toBe(1);
    expect(sample.suppressedBirths).toBe(4);
  });

  it('computes the mean age', () => {
    expect(sample.meanAge).toBeCloseTo((10 + 30 + 50 + 95) / 4);
  });

  it('buckets ages by decade with a 90-plus final bucket', () => {
    expect(sample.ageBuckets).toHaveLength(10);
    expect(sample.ageBuckets[1]).toBe(1);
    expect(sample.ageBuckets[3]).toBe(1);
    expect(sample.ageBuckets[5]).toBe(1);
    expect(sample.ageBuckets[9]).toBe(1);
    expect(sample.ageBuckets.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('reports a mean age of zero for an empty population', () => {
    const empty = computeSample({
      year: 5,
      agents: [],
      activeUnions: 0,
      births: 0,
      deaths: 7,
      suppressedBirths: 0,
    });
    expect(empty.population).toBe(0);
    expect(empty.meanAge).toBe(0);
    expect(empty.ageBuckets.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('StatsRecorder', () => {
  it('starts empty', () => {
    const recorder = new StatsRecorder();
    expect(recorder.series()).toEqual([]);
    expect(recorder.latest()).toBeNull();
  });

  it('keeps samples in recording order and exposes the latest', () => {
    const recorder = new StatsRecorder();
    const make = (year: number) =>
      computeSample({
        year,
        agents: [],
        activeUnions: 0,
        births: 0,
        deaths: 0,
        suppressedBirths: 0,
      });
    recorder.record(make(0));
    recorder.record(make(1));
    expect(recorder.series().map((s) => s.year)).toEqual([0, 1]);
    expect(recorder.latest()?.year).toBe(1);
  });
});

describe('serialization', () => {
  const series = [
    computeSample({
      year: 0,
      agents: [agentAged(0, 'male', 20)],
      activeUnions: 0,
      births: 0,
      deaths: 0,
      suppressedBirths: 0,
    }),
  ];

  it('writes a header row followed by one row per sample', () => {
    const lines = toCsv(series).trim().split('\n');
    expect(lines[0]).toBe(STATS_CSV_HEADER);
    expect(lines).toHaveLength(2);
  });

  it('writes one CSV column per header column', () => {
    const lines = toCsv(series).trim().split('\n');
    const headerColumns = STATS_CSV_HEADER.split(',').length;
    expect(lines[1]!.split(',')).toHaveLength(headerColumns);
  });

  it('round-trips through JSON', () => {
    expect(JSON.parse(toJson(series))).toEqual(series);
  });

  it('writes only a header for an empty series', () => {
    expect(toCsv([]).trim()).toBe(STATS_CSV_HEADER);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run packages/core/test/stats.test.ts`
Expected: FAIL — cannot resolve `../src/stats.js`.

- [ ] **Step 3: Implement the stats module**

`packages/core/src/stats.ts`:

```ts
import type { StatsSample, StatsSeries } from './types.js';
import type { Agent } from './agent.js';
import { ageOf } from './agent.js';

const BUCKET_COUNT = 10;

export const STATS_CSV_HEADER =
  'year,population,males,females,births,deaths,activeUnions,meanAge,' +
  'suppressedBirths,age0,age10,age20,age30,age40,age50,age60,age70,age80,age90plus';

export function computeSample(params: {
  year: number;
  agents: Agent[];
  activeUnions: number;
  births: number;
  deaths: number;
  suppressedBirths: number;
}): StatsSample {
  const { year, agents, activeUnions, births, deaths, suppressedBirths } =
    params;

  let males = 0;
  let ageTotal = 0;
  const ageBuckets = new Array<number>(BUCKET_COUNT).fill(0);

  for (const agent of agents) {
    if (agent.gender === 'male') males++;
    const age = ageOf(agent, year);
    ageTotal += age;
    const bucket = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(age / 10)));
    ageBuckets[bucket] = (ageBuckets[bucket] ?? 0) + 1;
  }

  return {
    year,
    population: agents.length,
    males,
    females: agents.length - males,
    births,
    deaths,
    activeUnions,
    meanAge: agents.length === 0 ? 0 : ageTotal / agents.length,
    ageBuckets,
    suppressedBirths,
  };
}

export class StatsRecorder {
  private readonly samples: StatsSample[] = [];

  record(sample: StatsSample): void {
    this.samples.push(sample);
  }

  series(): StatsSeries {
    return this.samples;
  }

  latest(): StatsSample | null {
    return this.samples.length === 0
      ? null
      : this.samples[this.samples.length - 1]!;
  }
}

export function toCsv(series: StatsSeries): string {
  const rows = [STATS_CSV_HEADER];
  for (const s of series) {
    rows.push(
      [
        s.year,
        s.population,
        s.males,
        s.females,
        s.births,
        s.deaths,
        s.activeUnions,
        s.meanAge.toFixed(3),
        s.suppressedBirths,
        ...s.ageBuckets,
      ].join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export function toJson(series: StatsSeries): string {
  return JSON.stringify(series, null, 2);
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run packages/core/test/stats.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/stats.ts packages/core/test/stats.test.ts
git commit -m "feat(core): statistics sampling, recording, CSV and JSON output"
```

---

## Task 8: Simulation core — stepping, aging, death, snapshots

**Files:**
- Create: `packages/core/src/bodies.ts`
- Create: `packages/core/src/simulation.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/bodies.test.ts`
- Test: `packages/core/test/simulation.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-7
- Produces:
  - `buildBodies(agents: Agent[], config: SimConfig): PhysicsBody[]`
  - `applyBodies(bodies: PhysicsBody[], byId: Map<AgentId, Agent>, config: SimConfig): void`
  - `class Simulation` with `static init(config: SimConfig, seed: number): Simulation`, `step(deltaYears: number): void`, `snapshot(): Snapshot`, `stats(): StatsSeries`, `get year(): number`, `get extinct(): boolean`, `get agentCount(): number`

Unions do not form yet — Task 9 adds that. But `buildBodies` and `applyBodies` already handle a bonded pair, because `Agent.partnerId` exists from Task 6 and splitting that logic across two tasks would mean rewriting it.

A bonded pair is one body centred on the pair's midpoint, with radius `bondOffset / 2 + agentRadius`, which exactly covers both members. After physics, the two members are placed symmetrically about that centre, perpendicular to the direction of travel.

- [ ] **Step 1: Write the failing test for bodies**

`packages/core/test/bodies.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createAgent } from '../src/agent.js';
import type { Agent } from '../src/agent.js';
import { buildBodies, applyBodies } from '../src/bodies.js';

function make(id: number, x: number, y: number): Agent {
  const agent = createAgent({
    id,
    gender: id % 2 === 0 ? 'male' : 'female',
    x,
    y,
    birthYear: 0,
    config: DEFAULT_CONFIG,
    rng: new Rng(id + 1),
  });
  agent.dx = 1;
  agent.dy = 0;
  agent.speed = 30;
  return agent;
}

describe('buildBodies', () => {
  it('creates one body per solo agent', () => {
    const agents = [make(0, 10, 10), make(1, 50, 50)];
    const bodies = buildBodies(agents, DEFAULT_CONFIG);
    expect(bodies).toHaveLength(2);
    expect(bodies.map((b) => b.agentId)).toEqual([0, 1]);
    expect(bodies[0]!.radius).toBe(DEFAULT_CONFIG.agentRadius);
  });

  it('creates a single body for a bonded pair, led by the lower id', () => {
    const a = make(3, 100, 100);
    const b = make(8, 110, 100);
    a.partnerId = 8;
    b.partnerId = 3;
    const bodies = buildBodies([a, b], DEFAULT_CONFIG);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.agentId).toBe(3);
  });

  it('centres the pair body on the midpoint with a covering radius', () => {
    const a = make(3, 100, 100);
    const b = make(8, 110, 100);
    a.partnerId = 8;
    b.partnerId = 3;
    const [pair] = buildBodies([a, b], DEFAULT_CONFIG);
    expect(pair!.x).toBeCloseTo(105);
    expect(pair!.y).toBeCloseTo(100);
    expect(pair!.radius).toBeCloseTo(
      DEFAULT_CONFIG.union.bondOffset / 2 + DEFAULT_CONFIG.agentRadius,
    );
  });

  it('skips an agent whose partner is missing', () => {
    const a = make(3, 100, 100);
    a.partnerId = 99;
    expect(buildBodies([a], DEFAULT_CONFIG)).toHaveLength(0);
  });
});

describe('applyBodies', () => {
  it('copies position and direction back to a solo agent', () => {
    const a = make(0, 10, 10);
    const byId = new Map([[0, a]]);
    const bodies = buildBodies([a], DEFAULT_CONFIG);
    bodies[0]!.x = 77;
    bodies[0]!.y = 88;
    bodies[0]!.dx = 0;
    bodies[0]!.dy = 1;
    applyBodies(bodies, byId, DEFAULT_CONFIG);
    expect(a.x).toBe(77);
    expect(a.y).toBe(88);
    expect(a.dy).toBe(1);
  });

  it('places bonded partners symmetrically about the body centre', () => {
    const a = make(3, 100, 100);
    const b = make(8, 110, 100);
    a.partnerId = 8;
    b.partnerId = 3;
    const byId = new Map([
      [3, a],
      [8, b],
    ]);
    const bodies = buildBodies([a, b], DEFAULT_CONFIG);
    applyBodies(bodies, byId, DEFAULT_CONFIG);

    const separation = Math.hypot(b.x - a.x, b.y - a.y);
    expect(separation).toBeCloseTo(DEFAULT_CONFIG.union.bondOffset);
    expect((a.x + b.x) / 2).toBeCloseTo(105);
    expect((a.y + b.y) / 2).toBeCloseTo(100);
  });

  it('gives bonded partners identical direction and speed', () => {
    const a = make(3, 100, 100);
    const b = make(8, 110, 100);
    a.partnerId = 8;
    b.partnerId = 3;
    b.speed = 99;
    const byId = new Map([
      [3, a],
      [8, b],
    ]);
    applyBodies(buildBodies([a, b], DEFAULT_CONFIG), byId, DEFAULT_CONFIG);
    expect(b.dx).toBe(a.dx);
    expect(b.dy).toBe(a.dy);
    expect(b.speed).toBe(a.speed);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run packages/core/test/bodies.test.ts`
Expected: FAIL — cannot resolve `../src/bodies.js`.

- [ ] **Step 3: Implement the body mapping**

`packages/core/src/bodies.ts`:

```ts
import type { AgentId } from './types.js';
import type { SimConfig } from './config.js';
import type { Agent } from './agent.js';
import type { PhysicsBody } from './physics.js';

/**
 * Maps agents onto physics bodies. A solo agent is its own body. A bonded pair
 * becomes one body centred on the pair's midpoint, represented by the lower id
 * and carrying a radius that covers both members plus the bond offset.
 */
export function buildBodies(agents: Agent[], config: SimConfig): PhysicsBody[] {
  const byId = new Map<AgentId, Agent>();
  for (const agent of agents) byId.set(agent.id, agent);

  const pairRadius = config.union.bondOffset / 2 + config.agentRadius;
  const bodies: PhysicsBody[] = [];

  for (const agent of agents) {
    if (agent.partnerId === null) {
      bodies.push({
        agentId: agent.id,
        x: agent.x,
        y: agent.y,
        dx: agent.dx,
        dy: agent.dy,
        speed: agent.speed,
        radius: config.agentRadius,
      });
      continue;
    }

    const partner = byId.get(agent.partnerId);
    if (partner === undefined) continue; // partner already removed
    if (agent.id > partner.id) continue; // the lower id leads

    bodies.push({
      agentId: agent.id,
      x: (agent.x + partner.x) / 2,
      y: (agent.y + partner.y) / 2,
      dx: agent.dx,
      dy: agent.dy,
      speed: agent.speed,
      radius: pairRadius,
    });
  }

  return bodies;
}

/** Writes post-physics body state back onto the agents it represents. */
export function applyBodies(
  bodies: PhysicsBody[],
  byId: Map<AgentId, Agent>,
  config: SimConfig,
): void {
  const half = config.union.bondOffset / 2;
  const r = config.agentRadius;

  for (const body of bodies) {
    const leader = byId.get(body.agentId);
    if (leader === undefined) continue;

    leader.dx = body.dx;
    leader.dy = body.dy;

    if (leader.partnerId === null) {
      leader.x = body.x;
      leader.y = body.y;
      continue;
    }

    const follower = byId.get(leader.partnerId);
    if (follower === undefined) {
      leader.x = body.x;
      leader.y = body.y;
      continue;
    }

    // Offset perpendicular to travel, symmetric about the body centre.
    const px = -body.dy * half;
    const py = body.dx * half;
    leader.x = clamp(body.x - px, r, config.world.width - r);
    leader.y = clamp(body.y - py, r, config.world.height - r);
    follower.x = clamp(body.x + px, r, config.world.width - r);
    follower.y = clamp(body.y + py, r, config.world.height - r);
    follower.dx = body.dx;
    follower.dy = body.dy;
    follower.speed = leader.speed;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run packages/core/test/bodies.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing test for the simulation**

`packages/core/test/simulation.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run packages/core/test/simulation.test.ts`
Expected: FAIL — cannot resolve `../src/simulation.js`.

- [ ] **Step 7: Implement the simulation**

`packages/core/src/simulation.ts`:

```ts
import type {
  AgentId,
  Snapshot,
  StatsSample,
  StatsSeries,
} from './types.js';
import type { SimConfig } from './config.js';
import { validateConfig, deriveSubStepsPerYear } from './config.js';
import { Rng } from './rng.js';
import { SpatialGrid } from './grid.js';
import { stepBodies } from './physics.js';
import { buildBodies, applyBodies } from './bodies.js';
import { ageOf, createInitialPopulation } from './agent.js';
import type { Agent } from './agent.js';
import { StatsRecorder, computeSample } from './stats.js';

export class Simulation {
  protected readonly config: SimConfig;
  protected readonly rng: Rng;
  protected readonly subStepsPerYear: number;
  protected readonly grid: SpatialGrid;
  protected readonly recorder = new StatsRecorder();

  /** Kept in ascending id order at all times. */
  protected agents: Agent[];
  protected byId = new Map<AgentId, Agent>();
  protected nextAgentId: number;

  /** Integer sub-step counter — the authoritative clock, so year boundaries
   *  land exactly and never drift through floating-point accumulation. */
  protected subStepsElapsed = 0;
  protected fractionalSubSteps = 0;

  protected birthsThisYear = 0;
  protected deathsThisYear = 0;
  protected suppressedBirthsThisYear = 0;

  protected constructor(config: SimConfig, seed: number) {
    validateConfig(config);
    this.config = config;
    this.rng = new Rng(seed);
    this.subStepsPerYear = deriveSubStepsPerYear(config);

    const cellSize = 2 * (config.union.bondOffset / 2 + config.agentRadius);
    this.grid = new SpatialGrid(
      config.world.width,
      config.world.height,
      cellSize,
    );

    this.agents = createInitialPopulation(config, this.rng);
    for (const agent of this.agents) this.byId.set(agent.id, agent);
    this.nextAgentId = this.agents.length;

    this.recorder.record(this.buildSample());
  }

  static init(config: SimConfig, seed: number): Simulation {
    return new Simulation(config, seed);
  }

  get year(): number {
    return this.subStepsElapsed / this.subStepsPerYear;
  }

  get extinct(): boolean {
    return this.agents.length === 0;
  }

  get agentCount(): number {
    return this.agents.length;
  }

  step(deltaYears: number): void {
    if (this.extinct || deltaYears <= 0) return;

    this.fractionalSubSteps += deltaYears * this.subStepsPerYear;
    const dt = 1 / this.subStepsPerYear;

    while (this.fractionalSubSteps >= 1) {
      this.fractionalSubSteps -= 1;
      this.runSubStep(dt);
      if (this.extinct) {
        this.fractionalSubSteps = 0;
        return;
      }
    }
  }

  snapshot(): Snapshot {
    const year = this.year;
    return {
      year,
      agents: this.agents.map((agent) => ({
        id: agent.id,
        gender: agent.gender,
        x: agent.x,
        y: agent.y,
        age: ageOf(agent, year),
        partnerId: agent.partnerId,
      })),
      worldWidth: this.config.world.width,
      worldHeight: this.config.world.height,
      agentRadius: this.config.agentRadius,
      extinct: this.extinct,
      atCapacity: this.agents.length >= this.config.maxAgents,
    };
  }

  stats(): StatsSeries {
    return this.recorder.series();
  }

  protected runSubStep(dt: number): void {
    const bodies = buildBodies(this.agents, this.config);
    const encounters = stepBodies(bodies, this.config.world, this.grid, dt);
    applyBodies(bodies, this.byId, this.config);
    this.onEncounters(encounters);

    this.subStepsElapsed++;
    if (this.subStepsElapsed % this.subStepsPerYear === 0) {
      this.annualTick();
    }
  }

  /** Extension point — Task 9 implements union formation here. */
  protected onEncounters(_encounters: Array<[AgentId, AgentId]>): void {
    // No reproduction in this task.
  }

  /** Extension point — Task 10 implements union expiry and births here. */
  protected annualEvents(): void {
    // No reproduction in this task.
  }

  protected annualTick(): void {
    this.applyDeaths();
    this.annualEvents();
    this.decrementCooldowns();
    this.recorder.record(this.buildSample());
    this.birthsThisYear = 0;
    this.deathsThisYear = 0;
    this.suppressedBirthsThisYear = 0;
  }

  protected applyDeaths(): void {
    const year = this.year;
    const survivors: Agent[] = [];
    for (const agent of this.agents) {
      if (ageOf(agent, year) >= agent.lifespan) {
        this.deathsThisYear++;
        this.byId.delete(agent.id);
        this.onDeath(agent);
      } else {
        survivors.push(agent);
      }
    }
    this.agents = survivors;
  }

  /** Extension point — Task 10 releases the surviving partner here. */
  protected onDeath(_agent: Agent): void {
    // No unions in this task.
  }

  protected decrementCooldowns(): void {
    for (const agent of this.agents) {
      if (agent.cooldownRemaining > 0) {
        agent.cooldownRemaining = Math.max(0, agent.cooldownRemaining - 1);
      }
    }
  }

  protected activeUnionCount(): number {
    return 0;
  }

  protected buildSample(): StatsSample {
    return computeSample({
      year: this.year,
      agents: this.agents,
      activeUnions: this.activeUnionCount(),
      births: this.birthsThisYear,
      deaths: this.deathsThisYear,
      suppressedBirths: this.suppressedBirthsThisYear,
    });
  }
}
```

`packages/core/src/index.ts`:

```ts
export { Simulation } from './simulation.js';
export {
  DEFAULT_CONFIG,
  validateConfig,
  deriveSubStepsPerYear,
  ConfigError,
} from './config.js';
export type { SimConfig, AgeWindow } from './config.js';
export { STATS_CSV_HEADER, toCsv, toJson } from './stats.js';
export type {
  Gender,
  AgentId,
  UnionId,
  AgentSnapshot,
  Snapshot,
  StatsSample,
  StatsSeries,
  Command,
  CommandResult,
} from './types.js';
```

- [ ] **Step 8: Run the full core test suite and verify it passes**

Run: `npx vitest run packages/core`
Expected: PASS, all suites.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/bodies.ts packages/core/src/simulation.ts packages/core/src/index.ts packages/core/test/bodies.test.ts packages/core/test/simulation.test.ts
git commit -m "feat(core): simulation stepping, aging, death, snapshots, extinction"
```

---

## Task 9: Unions — formation, bonding, expiry, widowhood

**Files:**
- Create: `packages/core/src/union.ts`
- Create: `packages/core/src/rules/pairing.ts`
- Modify: `packages/core/src/simulation.ts` — replace the `onEncounters`, `onDeath`, `annualEvents` and `activeUnionCount` stubs
- Modify: `packages/core/src/index.ts` — export the union types
- Test: `packages/core/test/pairing.test.ts`
- Test: `packages/core/test/unions.test.ts`

**Interfaces:**
- Consumes: `Agent`, `ageOf` (Task 6), `Simulation` (Task 8), `Rng` (Task 1)
- Produces:
  - `interface Union { id: UnionId; a: AgentId; b: AgentId; startYear: number; endYear: number }` where `a < b`
  - `class UnionRegistry { create(a: AgentId, b: AgentId, startYear: number, durationYears: number): Union; get(id: UnionId): Union | undefined; all(): Union[]; remove(id: UnionId): void; get size(): number }`
  - `isFertile(agent: Agent, year: number, config: SimConfig): boolean`
  - `canFormUnion(a: Agent, b: Agent, year: number, config: SimConfig): boolean`

- [ ] **Step 1: Write the failing test for pairing rules**

`packages/core/test/pairing.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createAgent } from '../src/agent.js';
import type { Agent } from '../src/agent.js';
import { isFertile, canFormUnion } from '../src/rules/pairing.js';

function agent(
  id: number,
  gender: 'male' | 'female',
  age: number,
): Agent {
  return createAgent({
    id,
    gender,
    x: 0,
    y: 0,
    birthYear: -age,
    config: DEFAULT_CONFIG,
    rng: new Rng(id + 1),
  });
}

describe('isFertile', () => {
  it('accepts an age inside the window', () => {
    expect(isFertile(agent(1, 'female', 30), 0, DEFAULT_CONFIG)).toBe(true);
  });

  it('rejects an age below the window', () => {
    expect(isFertile(agent(1, 'female', 10), 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('rejects an age above the window', () => {
    expect(isFertile(agent(1, 'female', 60), 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('uses the male window for men', () => {
    // 55 is inside the male window and outside the female one.
    expect(isFertile(agent(1, 'male', 55), 0, DEFAULT_CONFIG)).toBe(true);
    expect(isFertile(agent(2, 'female', 55), 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('accepts exactly the lower bound and rejects exactly the upper bound', () => {
    const min = DEFAULT_CONFIG.fertility.female.minAge;
    const max = DEFAULT_CONFIG.fertility.female.maxAge;
    expect(isFertile(agent(1, 'female', min), 0, DEFAULT_CONFIG)).toBe(true);
    expect(isFertile(agent(2, 'female', max), 0, DEFAULT_CONFIG)).toBe(false);
  });
});

describe('canFormUnion', () => {
  const male = () => agent(1, 'male', 30);
  const female = () => agent(2, 'female', 30);

  it('accepts two eligible agents of opposite gender', () => {
    expect(canFormUnion(male(), female(), 0, DEFAULT_CONFIG)).toBe(true);
  });

  it('accepts the pair regardless of argument order', () => {
    expect(canFormUnion(female(), male(), 0, DEFAULT_CONFIG)).toBe(true);
  });

  it('rejects two agents of the same gender', () => {
    expect(canFormUnion(male(), agent(3, 'male', 30), 0, DEFAULT_CONFIG)).toBe(
      false,
    );
  });

  it('rejects an agent who is already partnered', () => {
    const m = male();
    m.partnerId = 99;
    expect(canFormUnion(m, female(), 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('rejects when the other agent is already partnered', () => {
    const f = female();
    f.partnerId = 99;
    expect(canFormUnion(male(), f, 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('rejects an agent outside the fertility window', () => {
    expect(canFormUnion(male(), agent(4, 'female', 60), 0, DEFAULT_CONFIG)).toBe(
      false,
    );
  });

  it('rejects an agent still inside the re-pair cooldown', () => {
    const m = male();
    m.cooldownRemaining = 1;
    expect(canFormUnion(m, female(), 0, DEFAULT_CONFIG)).toBe(false);
  });

  it('rejects an agent paired with itself', () => {
    const m = male();
    expect(canFormUnion(m, m, 0, DEFAULT_CONFIG)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run packages/core/test/pairing.test.ts`
Expected: FAIL — cannot resolve `../src/rules/pairing.js`.

- [ ] **Step 3: Implement the union entity and the pairing rules**

`packages/core/src/union.ts`:

```ts
import type { AgentId, UnionId } from './types.js';

export interface Union {
  id: UnionId;
  /** Always the lower agent id. */
  a: AgentId;
  /** Always the higher agent id. */
  b: AgentId;
  startYear: number;
  /** The year at which this union dissolves on its own. */
  endYear: number;
}

export class UnionRegistry {
  private readonly unions = new Map<UnionId, Union>();
  private nextId = 0;

  create(
    a: AgentId,
    b: AgentId,
    startYear: number,
    durationYears: number,
  ): Union {
    const union: Union = {
      id: this.nextId++,
      a: Math.min(a, b),
      b: Math.max(a, b),
      startYear,
      endYear: startYear + durationYears,
    };
    this.unions.set(union.id, union);
    return union;
  }

  get(id: UnionId): Union | undefined {
    return this.unions.get(id);
  }

  /** Ascending union id order, so iteration is always stable. */
  all(): Union[] {
    return [...this.unions.values()].sort((x, y) => x.id - y.id);
  }

  remove(id: UnionId): void {
    this.unions.delete(id);
  }

  get size(): number {
    return this.unions.size;
  }
}
```

`packages/core/src/rules/pairing.ts`:

```ts
import type { SimConfig } from '../config.js';
import type { Agent } from '../agent.js';
import { ageOf } from '../agent.js';

/** Inclusive at the lower bound, exclusive at the upper. */
export function isFertile(
  agent: Agent,
  year: number,
  config: SimConfig,
): boolean {
  const window =
    agent.gender === 'male' ? config.fertility.male : config.fertility.female;
  const age = ageOf(agent, year);
  return age >= window.minAge && age < window.maxAge;
}

/** Every condition from the design's union gate, in one place. */
export function canFormUnion(
  a: Agent,
  b: Agent,
  year: number,
  config: SimConfig,
): boolean {
  if (a.id === b.id) return false;
  if (a.gender === b.gender) return false;
  if (a.partnerId !== null || b.partnerId !== null) return false;
  if (a.cooldownRemaining > 0 || b.cooldownRemaining > 0) return false;
  if (!isFertile(a, year, config)) return false;
  if (!isFertile(b, year, config)) return false;
  return true;
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run packages/core/test/pairing.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Write the failing test for unions in the simulation**

`packages/core/test/unions.test.ts`:

```ts
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
    const strict = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 50;
      }),
      29,
    );
    const loose = Simulation.init(
      config((c) => {
        c.union.minDurationYears = 1;
        c.union.maxDurationYears = 1;
        c.union.repairCooldownYears = 0;
      }),
      29,
    );
    strict.step(40);
    loose.step(40);
    expect(strict.stats().at(-1)!.activeUnions).toBeLessThan(
      loose.stats().at(-1)!.activeUnions,
    );
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
```

- [ ] **Step 6: Run it and verify it fails**

Run: `npx vitest run packages/core/test/unions.test.ts`
Expected: FAIL — unions never form, so `activeUnions` stays at zero.

- [ ] **Step 7: Wire unions into the simulation**

In `packages/core/src/simulation.ts`, add these imports beside the existing ones:

```ts
import { UnionRegistry } from './union.js';
import type { Union } from './union.js';
import { canFormUnion } from './rules/pairing.js';
```

Add the registry as a field, directly below `protected nextAgentId: number;`:

```ts
  protected readonly unions = new UnionRegistry();
```

Replace the `onEncounters` stub with:

```ts
  protected onEncounters(encounters: Array<[AgentId, AgentId]>): void {
    if (this.config.union.chance <= 0) return;
    const year = this.year;
    const stream = this.rng.stream('union');

    for (const [idA, idB] of encounters) {
      const a = this.byId.get(idA);
      const b = this.byId.get(idB);
      if (a === undefined || b === undefined) continue;
      if (!canFormUnion(a, b, year, this.config)) continue;
      if (!stream.bool(this.config.union.chance)) continue;

      const duration = stream.range(
        this.config.union.minDurationYears,
        this.config.union.maxDurationYears,
      );
      const union = this.unions.create(a.id, b.id, year, duration);
      a.partnerId = b.id;
      b.partnerId = a.id;
      a.unionId = union.id;
      b.unionId = union.id;
    }
  }
```

Replace the `onDeath` stub with:

```ts
  protected onDeath(agent: Agent): void {
    if (agent.unionId === null) return;
    const union = this.unions.get(agent.unionId);
    if (union !== undefined) this.dissolve(union, agent.id);
    agent.partnerId = null;
    agent.unionId = null;
  }

  /**
   * Ends a union and releases whichever partners are still alive, applying the
   * re-pair cooldown. `exceptId` is the agent who has just died, if any.
   */
  protected dissolve(union: Union, exceptId: AgentId | null): void {
    for (const id of [union.a, union.b]) {
      if (id === exceptId) continue;
      const survivor = this.byId.get(id);
      if (survivor === undefined) continue;
      survivor.partnerId = null;
      survivor.unionId = null;
      survivor.cooldownRemaining = this.config.union.repairCooldownYears;
    }
    this.unions.remove(union.id);
  }
```

Replace the `annualEvents` stub with:

```ts
  protected annualEvents(): void {
    this.expireUnions();
  }

  protected expireUnions(): void {
    const year = this.year;
    for (const union of this.unions.all()) {
      if (union.endYear <= year) this.dissolve(union, null);
    }
  }
```

Replace `activeUnionCount` with:

```ts
  protected activeUnionCount(): number {
    return this.unions.size;
  }
```

Add to `packages/core/src/index.ts`:

```ts
export { UnionRegistry } from './union.js';
export type { Union } from './union.js';
```

- [ ] **Step 8: Run the full core suite and verify it passes**

Run: `npx vitest run packages/core`
Expected: PASS, all suites including the Task 8 determinism tests.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/union.ts packages/core/src/rules/pairing.ts packages/core/src/simulation.ts packages/core/src/index.ts packages/core/test/pairing.test.ts packages/core/test/unions.test.ts
git commit -m "feat(core): union formation, bonded movement, expiry and widowhood"
```

---

## Task 10: Births and the capacity guardrail

**Files:**
- Create: `packages/core/src/rules/birth.ts`
- Modify: `packages/core/src/simulation.ts` — extend `annualEvents`
- Test: `packages/core/test/birth.test.ts`

**Interfaces:**
- Consumes: `Union`, `UnionRegistry` (Task 9), `createAgent` (Task 6)
- Produces: `createOffspring(params: { id: AgentId; x: number; y: number; birthYear: number; config: SimConfig; rng: Rng }): Agent`

Ordering inside the annual tick is fixed and must not change: deaths, then union expiry, then births, then cooldowns, then the stats sample. A union that expires this year produces no birth this year.

The birth roll happens **before** the capacity check, so that hitting `maxAgents` suppresses the offspring without altering how much randomness the run consumes. A capped run and an uncapped run therefore stay comparable.

- [ ] **Step 1: Write the failing test**

`packages/core/test/birth.test.ts`:

```ts
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
    sim.step(30);
    const newborns = sim
      .snapshot()
      .agents.filter((a) => a.id >= DEFAULT_CONFIG.startingPopulation);
    expect(newborns.length).toBeGreaterThan(0);
    for (const newborn of newborns) {
      expect(newborn.age).toBeGreaterThanOrEqual(0);
      expect(newborn.age).toBeLessThanOrEqual(30);
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
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run packages/core/test/birth.test.ts`
Expected: FAIL — no births are ever recorded.

- [ ] **Step 3: Implement offspring construction**

`packages/core/src/rules/birth.ts`:

```ts
import type { AgentId, Gender } from '../types.js';
import type { SimConfig } from '../config.js';
import type { Rng } from '../rng.js';
import { createAgent } from '../agent.js';
import type { Agent } from '../agent.js';

/** A newborn: age zero, unpartnered, its own lifespan and speed. */
export function createOffspring(params: {
  id: AgentId;
  x: number;
  y: number;
  birthYear: number;
  config: SimConfig;
  rng: Rng;
}): Agent {
  const { id, x, y, birthYear, config, rng } = params;
  const gender: Gender = rng.stream('birth').bool(config.sexRatioMale)
    ? 'male'
    : 'female';

  const r = config.agentRadius;
  return createAgent({
    id,
    gender,
    x: Math.min(config.world.width - r, Math.max(r, x)),
    y: Math.min(config.world.height - r, Math.max(r, y)),
    birthYear,
    config,
    rng,
  });
}
```

- [ ] **Step 4: Wire births into the annual tick**

In `packages/core/src/simulation.ts`, add the import:

```ts
import { createOffspring } from './rules/birth.js';
```

Replace `annualEvents` with:

```ts
  protected annualEvents(): void {
    this.expireUnions();
    this.applyBirths();
  }

  /**
   * One birth roll per surviving union. The roll is consumed before the
   * capacity check so that a capped run and an uncapped run draw the same
   * randomness and stay comparable.
   */
  protected applyBirths(): void {
    if (this.config.birthChancePerYear <= 0) return;
    const year = this.year;
    const stream = this.rng.stream('birth');

    for (const union of this.unions.all()) {
      const a = this.byId.get(union.a);
      const b = this.byId.get(union.b);
      if (a === undefined || b === undefined) continue;
      if (!stream.bool(this.config.birthChancePerYear)) continue;

      if (this.agents.length >= this.config.maxAgents) {
        this.suppressedBirthsThisYear++;
        continue;
      }

      const child = createOffspring({
        id: this.nextAgentId++,
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
        birthYear: year,
        config: this.config,
        rng: this.rng,
      });
      this.agents.push(child);
      this.byId.set(child.id, child);
      this.birthsThisYear++;
    }
  }
```

Newborn ids always exceed every existing id, so appending keeps `this.agents` in ascending id order, which the physics and grid rely on.

- [ ] **Step 5: Run the full core suite and verify it passes**

Run: `npx vitest run packages/core`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/rules/birth.ts packages/core/src/simulation.ts packages/core/test/birth.test.ts
git commit -m "feat(core): annual birth rolls and the maxAgents guardrail"
```

---

## Task 11: The command seam

**Files:**
- Modify: `packages/core/src/stats.ts` — add `clear()` to `StatsRecorder`
- Modify: `packages/core/src/union.ts` — add `clear()` to `UnionRegistry`
- Modify: `packages/core/src/simulation.ts` — add `command`, make resettable fields mutable
- Test: `packages/core/test/command.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandResult` (Task 2), `Simulation` (Task 8)
- Produces: `Simulation.command(cmd: Command): CommandResult`

`Command` is a discriminated union so that later game interventions are added as new variants without reshaping the interface. Only `reset`, `runToYear` and `exportStats` exist; no speculative variants.

- [ ] **Step 1: Write the failing test**

`packages/core/test/command.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { Simulation } from '../src/simulation.js';
import { STATS_CSV_HEADER } from '../src/stats.js';

describe('command: runToYear', () => {
  it('advances to the requested year', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    sim.command({ type: 'runToYear', year: 25 });
    expect(sim.year).toBe(25);
  });

  it('returns ok', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    expect(sim.command({ type: 'runToYear', year: 5 })).toEqual({ type: 'ok' });
  });

  it('does nothing when the target is already past', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 51);
    sim.step(30);
    const before = sim.snapshot();
    sim.command({ type: 'runToYear', year: 10 });
    expect(sim.year).toBe(30);
    expect(sim.snapshot()).toEqual(before);
  });

  it('matches the state reached by stepping directly', () => {
    const viaCommand = Simulation.init(DEFAULT_CONFIG, 52);
    viaCommand.command({ type: 'runToYear', year: 40 });
    const viaStep = Simulation.init(DEFAULT_CONFIG, 52);
    viaStep.step(40);
    expect(viaCommand.snapshot()).toEqual(viaStep.snapshot());
    expect(viaCommand.stats()).toEqual(viaStep.stats());
  });
});

describe('command: reset', () => {
  it('returns to year zero with the starting population', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 53);
    sim.step(40);
    sim.command({ type: 'reset', seed: 53 });
    expect(sim.year).toBe(0);
    expect(sim.agentCount).toBe(DEFAULT_CONFIG.startingPopulation);
  });

  it('discards the previous stats series', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 53);
    sim.step(40);
    sim.command({ type: 'reset', seed: 53 });
    expect(sim.stats()).toHaveLength(1);
    expect(sim.stats()[0]!.year).toBe(0);
  });

  it('reproduces the original run when reset to the same seed', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 54);
    sim.step(30);
    const original = sim.snapshot();

    sim.command({ type: 'reset', seed: 54 });
    sim.step(30);
    expect(sim.snapshot()).toEqual(original);
  });

  it('produces a different run for a different seed', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 54);
    sim.step(30);
    const original = sim.snapshot().agents;

    sim.command({ type: 'reset', seed: 55 });
    sim.step(30);
    expect(sim.snapshot().agents).not.toEqual(original);
  });

  it('clears unions and partner links', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 56);
    sim.step(30);
    sim.command({ type: 'reset', seed: 56 });
    expect(sim.stats()[0]!.activeUnions).toBe(0);
    for (const agent of sim.snapshot().agents) {
      expect(agent.partnerId).toBeNull();
    }
  });

  it('revives a simulation that had gone extinct', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 57);
    sim.step(250);
    sim.command({ type: 'reset', seed: 57 });
    expect(sim.extinct).toBe(false);
    sim.step(1);
    expect(sim.year).toBe(1);
  });
});

describe('command: exportStats', () => {
  it('returns CSV with the shared header', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 58);
    sim.step(5);
    const result = sim.command({ type: 'exportStats', format: 'csv' });
    expect(result.type).toBe('stats');
    if (result.type !== 'stats') throw new Error('expected stats');
    expect(result.format).toBe('csv');
    expect(result.data.split('\n')[0]).toBe(STATS_CSV_HEADER);
    expect(result.data.trim().split('\n')).toHaveLength(7);
  });

  it('returns JSON that parses back to the series', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, 58);
    sim.step(5);
    const result = sim.command({ type: 'exportStats', format: 'json' });
    if (result.type !== 'stats') throw new Error('expected stats');
    expect(JSON.parse(result.data)).toEqual(sim.stats());
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run packages/core/test/command.test.ts`
Expected: FAIL — `sim.command` is not a function.

- [ ] **Step 3: Add clear methods**

In `packages/core/src/stats.ts`, add to `StatsRecorder`:

```ts
  clear(): void {
    this.samples.length = 0;
  }
```

In `packages/core/src/union.ts`, add to `UnionRegistry`:

```ts
  clear(): void {
    this.unions.clear();
    this.nextId = 0;
  }
```

- [ ] **Step 4: Implement the command seam**

In `packages/core/src/simulation.ts`, change these three field declarations so a reset can rebuild them:

```ts
  protected rng: Rng;
  protected readonly recorder = new StatsRecorder();
  protected readonly unions = new UnionRegistry();
```

becomes

```ts
  protected rng: Rng;
  protected recorder = new StatsRecorder();
  protected unions = new UnionRegistry();
```

(`rng` is already declared without `readonly` if you wrote it as shown in Task 8; if it reads `protected readonly rng: Rng;`, drop the `readonly`.)

Add the import:

```ts
import type { Command, CommandResult } from './types.js';
import { toCsv, toJson } from './stats.js';
```

Add these public methods after `stats()`:

```ts
  command(cmd: Command): CommandResult {
    switch (cmd.type) {
      case 'reset':
        this.reset(cmd.seed);
        return { type: 'ok' };
      case 'runToYear': {
        const remaining = cmd.year - this.year;
        if (remaining > 0) this.step(remaining);
        return { type: 'ok' };
      }
      case 'exportStats':
        return {
          type: 'stats',
          format: cmd.format,
          data:
            cmd.format === 'csv'
              ? toCsv(this.stats())
              : toJson(this.stats()),
        };
    }
  }

  protected reset(seed: number): void {
    this.rng = new Rng(seed);
    this.unions.clear();
    this.recorder.clear();
    this.grid.clear();

    this.subStepsElapsed = 0;
    this.fractionalSubSteps = 0;
    this.birthsThisYear = 0;
    this.deathsThisYear = 0;
    this.suppressedBirthsThisYear = 0;

    this.agents = createInitialPopulation(this.config, this.rng);
    this.byId = new Map();
    for (const agent of this.agents) this.byId.set(agent.id, agent);
    this.nextAgentId = this.agents.length;

    this.recorder.record(this.buildSample());
  }
```

- [ ] **Step 5: Run the full core suite and verify it passes**

Run: `npx vitest run packages/core`
Expected: PASS, all suites.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/stats.ts packages/core/src/union.ts packages/core/src/simulation.ts packages/core/test/command.test.ts
git commit -m "feat(core): command seam with reset, runToYear and exportStats"
```

---

## Task 12: Headless CLI and the golden-run regression test

**Files:**
- Create: `packages/cli/package.json`, `packages/cli/tsconfig.json`
- Create: `packages/cli/src/args.ts`, `packages/cli/src/index.ts`
- Create: `packages/cli/scripts/update-golden.ts`
- Test: `packages/cli/test/args.test.ts`, `packages/cli/test/golden.test.ts`
- Modify: root `package.json` — add the `golden:update` script

**Interfaces:**
- Consumes: `Simulation`, `DEFAULT_CONFIG`, `toCsv`, `toJson` (Tasks 1-11)
- Produces: `parseArgs(argv: string[]): CliOptions` where `interface CliOptions { years: number; seed: number; format: 'csv' | 'json'; configPath: string | null; outPath: string | null }`, and `runSimulation(options: CliOptions, config: SimConfig): string`

The golden test compares against a committed fixture rather than hardcoded numbers. The fixture is generated once by a script and then frozen; any later change to iteration order or rule evaluation breaks the comparison.

- [ ] **Step 1: Create the package**

`packages/cli/package.json`:

```json
{
  "name": "@thrive/cli",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": { "thrive": "./src/index.ts" },
  "dependencies": { "@thrive/core": "*" }
}
```

`packages/cli/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts"],
  "references": [{ "path": "../core" }]
}
```

Add to the root `package.json` scripts:

```json
"golden:update": "npx tsx packages/cli/scripts/update-golden.ts"
```

and to root `devDependencies`:

```json
"tsx": "^4.19.2"
```

Then run `npm install`.

- [ ] **Step 2: Write the failing test for argument parsing**

`packages/cli/test/args.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('parses years and seed', () => {
    const options = parseArgs(['--years', '500', '--seed', '42']);
    expect(options.years).toBe(500);
    expect(options.seed).toBe(42);
  });

  it('defaults the seed to one', () => {
    expect(parseArgs(['--years', '10']).seed).toBe(1);
  });

  it('defaults the format to csv', () => {
    expect(parseArgs(['--years', '10']).format).toBe('csv');
  });

  it('accepts json as a format', () => {
    expect(parseArgs(['--years', '10', '--format', 'json']).format).toBe(
      'json',
    );
  });

  it('rejects an unknown format', () => {
    expect(() => parseArgs(['--years', '10', '--format', 'xml'])).toThrow(
      /format/,
    );
  });

  it('requires years', () => {
    expect(() => parseArgs([])).toThrow(/--years/);
  });

  it('rejects non-numeric years', () => {
    expect(() => parseArgs(['--years', 'many'])).toThrow(/--years/);
  });

  it('rejects zero or negative years', () => {
    expect(() => parseArgs(['--years', '0'])).toThrow(/--years/);
    expect(() => parseArgs(['--years', '-5'])).toThrow(/--years/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--years', '10', '--colour', 'red'])).toThrow(
      /--colour/,
    );
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArgs(['--years'])).toThrow(/--years/);
  });

  it('defaults the config and output paths to null', () => {
    const options = parseArgs(['--years', '10']);
    expect(options.configPath).toBeNull();
    expect(options.outPath).toBeNull();
  });

  it('parses the config and output paths', () => {
    const options = parseArgs([
      '--years',
      '10',
      '--config',
      'a.json',
      '--out',
      'b.csv',
    ]);
    expect(options.configPath).toBe('a.json');
    expect(options.outPath).toBe('b.csv');
  });
});
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run packages/cli/test/args.test.ts`
Expected: FAIL — cannot resolve `../src/args.js`.

- [ ] **Step 4: Implement argument parsing and the entry point**

`packages/cli/src/args.ts`:

```ts
export interface CliOptions {
  years: number;
  seed: number;
  format: 'csv' | 'json';
  configPath: string | null;
  outPath: string | null;
}

export const USAGE =
  'Usage: thrive --years <n> [--seed <n>] [--format csv|json] ' +
  '[--config <path>] [--out <path>]';

export function parseArgs(argv: string[]): CliOptions {
  let years: number | null = null;
  let seed = 1;
  let format: 'csv' | 'json' = 'csv';
  let configPath: string | null = null;
  let outPath: string | null = null;

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(flag + ' requires a value. ' + USAGE);
    }

    switch (flag) {
      case '--years':
        years = Number(value);
        if (!Number.isFinite(years) || years <= 0) {
          throw new Error('--years must be a positive number. ' + USAGE);
        }
        break;
      case '--seed':
        seed = Number(value);
        if (!Number.isFinite(seed)) {
          throw new Error('--seed must be a number. ' + USAGE);
        }
        break;
      case '--format':
        if (value !== 'csv' && value !== 'json') {
          throw new Error('--format must be csv or json. ' + USAGE);
        }
        format = value;
        break;
      case '--config':
        configPath = value;
        break;
      case '--out':
        outPath = value;
        break;
      default:
        throw new Error('Unknown flag ' + flag + '. ' + USAGE);
    }
  }

  if (years === null) throw new Error('--years is required. ' + USAGE);
  return { years, seed, format, configPath, outPath };
}
```

`packages/cli/src/index.ts`:

```ts
import { readFileSync, writeFileSync } from 'node:fs';
import { Simulation, DEFAULT_CONFIG, validateConfig } from '@thrive/core';
import type { SimConfig } from '@thrive/core';
import { parseArgs } from './args.js';
import type { CliOptions } from './args.js';

export function loadConfig(configPath: string | null): SimConfig {
  if (configPath === null) return structuredClone(DEFAULT_CONFIG);
  const merged = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(JSON.parse(readFileSync(configPath, 'utf8')) as Partial<SimConfig>),
  } as SimConfig;
  validateConfig(merged);
  return merged;
}

export function runSimulation(options: CliOptions, config: SimConfig): string {
  const sim = Simulation.init(config, options.seed);
  sim.command({ type: 'runToYear', year: options.years });
  const result = sim.command({
    type: 'exportStats',
    format: options.format,
  });
  if (result.type !== 'stats') throw new Error('expected a stats result');
  return result.data;
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    const config = loadConfig(options.configPath);
    const output = runSimulation(options, config);
    if (options.outPath === null) {
      process.stdout.write(output);
    } else {
      writeFileSync(options.outPath, output, 'utf8');
      // The design requires the config to travel with any run's results, so a
      // CSV on disk is never separated from the parameters that produced it.
      writeFileSync(
        options.outPath + '.config.json',
        JSON.stringify({ seed: options.seed, years: options.years, config }, null, 2) +
          '\n',
        'utf8',
      );
    }
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + '\n',
    );
    process.exitCode = 1;
  }
}

main();
```

- [ ] **Step 5: Run the args test and verify it passes**

Run: `npx vitest run packages/cli/test/args.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 6: Write the golden fixture generator and the golden test**

`packages/cli/scripts/update-golden.ts`:

```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Simulation, DEFAULT_CONFIG } from '@thrive/core';
import { GOLDEN_PATH, GOLDEN_SEED, GOLDEN_YEARS } from '../test/golden-spec.js';

const sim = Simulation.init(DEFAULT_CONFIG, GOLDEN_SEED);
sim.command({ type: 'runToYear', year: GOLDEN_YEARS });

mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
writeFileSync(GOLDEN_PATH, JSON.stringify(sim.stats(), null, 2) + '\n', 'utf8');
process.stdout.write('Wrote ' + GOLDEN_PATH + '\n');
```

`packages/cli/test/golden-spec.ts`:

```ts
import { fileURLToPath } from 'node:url';

export const GOLDEN_SEED = 42;
export const GOLDEN_YEARS = 200;
export const GOLDEN_PATH = fileURLToPath(
  new URL('./fixtures/golden-seed42-200y.json', import.meta.url),
);
```

`packages/cli/test/golden.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Simulation, DEFAULT_CONFIG } from '@thrive/core';
import type { StatsSeries } from '@thrive/core';
import { GOLDEN_PATH, GOLDEN_SEED, GOLDEN_YEARS } from './golden-spec.js';
import { runSimulation } from '../src/index.js';

function golden(): StatsSeries {
  return JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as StatsSeries;
}

describe('golden run', () => {
  it('reproduces the committed fixture exactly', () => {
    const sim = Simulation.init(DEFAULT_CONFIG, GOLDEN_SEED);
    sim.command({ type: 'runToYear', year: GOLDEN_YEARS });
    expect(sim.stats()).toEqual(golden());
  });

  it('has a sample for every year including year zero', () => {
    expect(golden()).toHaveLength(GOLDEN_YEARS + 1);
  });

  it('is a non-trivial run', () => {
    const series = golden();
    expect(series.reduce((acc, s) => acc + s.births, 0)).toBeGreaterThan(0);
    expect(series.reduce((acc, s) => acc + s.deaths, 0)).toBeGreaterThan(0);
    expect(Math.max(...series.map((s) => s.activeUnions))).toBeGreaterThan(0);
  });

  it('matches what the CLI path produces', () => {
    const output = runSimulation(
      {
        years: GOLDEN_YEARS,
        seed: GOLDEN_SEED,
        format: 'json',
        configPath: null,
        outPath: null,
      },
      structuredClone(DEFAULT_CONFIG),
    );
    expect(JSON.parse(output)).toEqual(golden());
  });
});
```

Note: `packages/cli/src/index.ts` calls `main()` at module scope, which would run on import from the test. Guard it by replacing the final `main();` line with:

```ts
if (process.env.VITEST === undefined) main();
```

- [ ] **Step 7: Generate the fixture and verify the test passes**

Run: `npm run golden:update`
Expected: writes `packages/cli/test/fixtures/golden-seed42-200y.json`.

Then inspect the fixture and confirm it describes a plausible run — a non-zero peak population, births and deaths both occurring. If the population collapses immediately or pins to `maxAgents` within a few years, stop and report it: that means the default parameters are wrong, not the code.

Run: `npx vitest run packages/cli`
Expected: PASS, 16 tests.

- [ ] **Step 8: Commit**

```bash
git add packages/cli package.json package-lock.json
git commit -m "feat(cli): headless runner and golden-run regression fixture"
```

---

## Task 13: Worker protocol and the clock

**Files:**
- Create: `packages/worker/package.json`, `packages/worker/tsconfig.json`
- Create: `packages/worker/src/protocol.ts`, `packages/worker/src/clock.ts`
- Test: `packages/worker/test/clock.test.ts`

**Interfaces:**
- Consumes: `SimConfig`, `Snapshot`, `StatsSample` (Task 2)
- Produces: `ToWorker`, `FromWorker` message unions; `class Clock { constructor(secondsPerYear: number); setSpeed(secondsPerYear: number): void; get secondsPerYear(): number; advance(elapsedMs: number): number }`; `MAX_CATCH_UP_YEARS`

The clock is the one piece of the time layer that is pure, so it is the one piece that gets unit tests. The worker glue around it is verified by running the app in Task 16.

- [ ] **Step 1: Create the package**

`packages/worker/package.json`:

```json
{
  "name": "@thrive/worker",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/worker.ts",
  "dependencies": { "@thrive/core": "*" }
}
```

`packages/worker/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "lib": ["ES2022", "WebWorker"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "references": [{ "path": "../core" }]
}
```

Run `npm install`.

- [ ] **Step 2: Write the failing test**

`packages/worker/test/clock.test.ts`:

```ts
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
```

- [ ] **Step 3: Run it and verify it fails**

Run: `npx vitest run packages/worker/test/clock.test.ts`
Expected: FAIL — cannot resolve `../src/clock.js`.

- [ ] **Step 4: Implement the clock and the protocol**

`packages/worker/src/clock.ts`:

```ts
/** A stalled or backgrounded tab must not fast-forward on resume. */
export const MAX_CATCH_UP_YEARS = 1;

export class Clock {
  private rate: number;

  constructor(secondsPerYear: number) {
    this.rate = 0;
    this.setSpeed(secondsPerYear);
  }

  setSpeed(secondsPerYear: number): void {
    if (!Number.isFinite(secondsPerYear) || secondsPerYear <= 0) {
      throw new Error('secondsPerYear must be a positive number');
    }
    this.rate = secondsPerYear;
  }

  get secondsPerYear(): number {
    return this.rate;
  }

  /** Simulated years to advance for the given wall-clock elapsed time. */
  advance(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    const years = elapsedMs / 1000 / this.rate;
    return Math.min(MAX_CATCH_UP_YEARS, years);
  }
}
```

`packages/worker/src/protocol.ts`:

```ts
import type { SimConfig, Snapshot, StatsSample } from '@thrive/core';

export type ToWorker =
  | { type: 'init'; config: SimConfig; seed: number; secondsPerYear: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'setSpeed'; secondsPerYear: number }
  | { type: 'stepYear' }
  | { type: 'runToYear'; year: number }
  | { type: 'cancel' }
  | { type: 'reset'; config: SimConfig; seed: number }
  | { type: 'requestStats'; format: 'csv' | 'json' };

export type FromWorker =
  | {
      type: 'snapshot';
      snapshot: Snapshot;
      latest: StatsSample | null;
      running: boolean;
    }
  | { type: 'progress'; year: number; targetYear: number }
  | { type: 'progressDone' }
  | { type: 'stats'; format: 'csv' | 'json'; data: string }
  | { type: 'extinct'; year: number }
  | { type: 'error'; message: string };
```

- [ ] **Step 5: Run it and verify it passes**

Run: `npx vitest run packages/worker/test/clock.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/worker package.json package-lock.json
git commit -m "feat(worker): message protocol and wall-clock to years conversion"
```

---

## Task 14: Worker entry and main-thread client

**Files:**
- Create: `packages/worker/src/worker.ts`
- Create: `packages/ui/package.json`, `packages/ui/tsconfig.json`
- Create: `packages/ui/src/sim.worker.ts`, `packages/ui/src/simClient.ts`

**Interfaces:**
- Consumes: `Clock`, `ToWorker`, `FromWorker` (Task 13), `Simulation` (Task 11)
- Produces: `class SimClient` with `onSnapshot`, `onStats`, `onProgress`, `onError` callbacks and methods `init`, `play`, `pause`, `setSpeed`, `stepYear`, `runToYear`, `cancel`, `reset`, `requestStats`, `terminate`

This task is glue between two runtimes and has no unit tests — the testable part was extracted into `Clock` in Task 13. It is verified by running the app at the end of Task 16.

Fast-forward is chunked: the worker advances a fixed number of years, posts progress, then yields via `setTimeout(0)` so that a `cancel` message can be received. Without the yield the worker would be unreachable for the whole run.

- [ ] **Step 1: Implement the worker entry**

`packages/worker/src/worker.ts`:

```ts
import { Simulation } from '@thrive/core';
import type { SimConfig } from '@thrive/core';
import { Clock } from './clock.js';
import type { ToWorker, FromWorker } from './protocol.js';

/** Years advanced per fast-forward chunk before yielding to the message queue. */
const CHUNK_YEARS = 5;
/** Real-time playback tick, roughly 60 Hz. */
const TICK_MS = 16;

let sim: Simulation | null = null;
let config: SimConfig | null = null;
let clock = new Clock(1);
let running = false;
let ticking: ReturnType<typeof setInterval> | null = null;
let lastTickAt = 0;
let cancelRequested = false;

function post(message: FromWorker): void {
  (self as unknown as Worker).postMessage(message);
}

function postSnapshot(): void {
  if (sim === null) return;
  post({
    type: 'snapshot',
    snapshot: sim.snapshot(),
    latest: sim.stats().at(-1) ?? null,
    running,
  });
}

function stopTicking(): void {
  running = false;
  if (ticking !== null) {
    clearInterval(ticking);
    ticking = null;
  }
}

function tick(): void {
  if (sim === null) return;
  const now = Date.now();
  const elapsed = now - lastTickAt;
  lastTickAt = now;

  sim.step(clock.advance(elapsed));
  postSnapshot();

  if (sim.extinct) {
    stopTicking();
    post({ type: 'extinct', year: sim.year });
    postSnapshot();
  }
}

function startTicking(): void {
  if (sim === null || running || sim.extinct) return;
  running = true;
  lastTickAt = Date.now();
  ticking = setInterval(tick, TICK_MS);
}

/** Advances in chunks, yielding between them so cancel can be received. */
function runToYear(target: number): void {
  if (sim === null) return;
  stopTicking();
  cancelRequested = false;

  const chunk = (): void => {
    if (sim === null) return;
    if (cancelRequested || sim.extinct || sim.year >= target) {
      post({ type: 'progressDone' });
      postSnapshot();
      if (sim.extinct) post({ type: 'extinct', year: sim.year });
      return;
    }

    sim.step(Math.min(CHUNK_YEARS, target - sim.year));
    post({ type: 'progress', year: sim.year, targetYear: target });
    postSnapshot();
    setTimeout(chunk, 0);
  };

  chunk();
}

function handle(message: ToWorker): void {
  switch (message.type) {
    case 'init':
    case 'reset': {
      stopTicking();
      cancelRequested = true;
      config = message.config;
      if (message.type === 'init') clock = new Clock(message.secondsPerYear);
      sim = Simulation.init(config, message.seed);
      postSnapshot();
      break;
    }
    case 'play':
      startTicking();
      postSnapshot();
      break;
    case 'pause':
      stopTicking();
      postSnapshot();
      break;
    case 'setSpeed':
      clock.setSpeed(message.secondsPerYear);
      break;
    case 'stepYear':
      stopTicking();
      sim?.step(1);
      postSnapshot();
      break;
    case 'runToYear':
      runToYear(message.year);
      break;
    case 'cancel':
      cancelRequested = true;
      stopTicking();
      break;
    case 'requestStats': {
      if (sim === null) break;
      const result = sim.command({
        type: 'exportStats',
        format: message.format,
      });
      if (result.type === 'stats') {
        post({ type: 'stats', format: result.format, data: result.data });
      }
      break;
    }
  }
}

self.addEventListener('message', (event: MessageEvent<ToWorker>) => {
  try {
    handle(event.data);
  } catch (error) {
    post({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });
  }
});
```

- [ ] **Step 2: Create the UI package**

`packages/ui/package.json`:

```json
{
  "name": "@thrive/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@thrive/core": "*",
    "@thrive/worker": "*"
  },
  "devDependencies": { "vite": "^5.4.10" }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": ".",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts"],
  "references": [{ "path": "../core" }, { "path": "../worker" }]
}
```

Run `npm install`.

- [ ] **Step 3: Implement the main-thread client**

Vite resolves a worker URL only when it is a **relative** path literal, so the
UI package owns a one-line re-export that the worker URL points at.

`packages/ui/src/sim.worker.ts`:

```ts
// Vite needs a relative worker entry; the implementation lives in @thrive/worker.
import '@thrive/worker/src/worker.js';
```

If Vite cannot resolve that bare specifier to the TypeScript source, replace the
import with the relative path `'../../worker/src/worker.ts'`. Verify which form
works before finishing the task — the worker failing to load is silent in the
console until a snapshot never arrives.

`packages/ui/src/simClient.ts`:

```ts
import type { SimConfig, Snapshot, StatsSample } from '@thrive/core';
import type { ToWorker, FromWorker } from '@thrive/worker/src/protocol.js';

export interface SimClientHandlers {
  onSnapshot(snapshot: Snapshot, latest: StatsSample | null, running: boolean): void;
  onProgress(year: number, targetYear: number): void;
  onProgressDone(): void;
  onStats(format: 'csv' | 'json', data: string): void;
  onExtinct(year: number): void;
  onError(message: string): void;
}

/**
 * Main-thread wrapper around the simulation worker. The UI never holds a
 * Simulation; it only ever sees the snapshots this client forwards.
 */
export class SimClient {
  private readonly worker: Worker;

  constructor(private readonly handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), {
      type: 'module',
    });

    this.worker.addEventListener('message', (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      switch (message.type) {
        case 'snapshot':
          handlers.onSnapshot(message.snapshot, message.latest, message.running);
          break;
        case 'progress':
          handlers.onProgress(message.year, message.targetYear);
          break;
        case 'progressDone':
          handlers.onProgressDone();
          break;
        case 'stats':
          handlers.onStats(message.format, message.data);
          break;
        case 'extinct':
          handlers.onExtinct(message.year);
          break;
        case 'error':
          handlers.onError(message.message);
          break;
      }
    });

    // A crashed worker must surface, not leave a frozen canvas on screen.
    this.worker.addEventListener('error', (event) => {
      handlers.onError('Simulation worker failed: ' + event.message);
    });
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  init(config: SimConfig, seed: number, secondsPerYear: number): void {
    this.send({ type: 'init', config, seed, secondsPerYear });
  }

  reset(config: SimConfig, seed: number): void {
    this.send({ type: 'reset', config, seed });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  setSpeed(secondsPerYear: number): void {
    this.send({ type: 'setSpeed', secondsPerYear });
  }

  stepYear(): void {
    this.send({ type: 'stepYear' });
  }

  runToYear(year: number): void {
    this.send({ type: 'runToYear', year });
  }

  cancel(): void {
    this.send({ type: 'cancel' });
  }

  requestStats(format: 'csv' | 'json'): void {
    this.send({ type: 'requestStats', format });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
```

- [ ] **Step 4: Verify the whole suite still passes**

Run: `npx vitest run`
Expected: PASS — this task adds no tests but must break none.

- [ ] **Step 5: Commit**

```bash
git add packages/worker/src/worker.ts packages/ui package.json package-lock.json
git commit -m "feat(worker,ui): worker entry with chunked fast-forward and client wrapper"
```

---

## Task 15: Viewport mapping and the canvas renderer

**Files:**
- Create: `packages/ui/src/viewport.ts`
- Create: `packages/ui/src/renderer.ts`
- Test: `packages/ui/test/viewport.test.ts`

**Interfaces:**
- Consumes: `Snapshot` (Task 2)
- Produces:
  - `interface Viewport { scale: number; offsetX: number; offsetY: number }`
  - `fitViewport(worldWidth: number, worldHeight: number, canvasWidth: number, canvasHeight: number): Viewport`
  - `worldToScreen(viewport: Viewport, x: number, y: number): { x: number; y: number }`
  - `drawScene(ctx: CanvasRenderingContext2D, snapshot: Snapshot, viewport: Viewport, options: { colorByAge: boolean }): void`

Per the design, the viewport mapping is the only part of the UI with unit tests; canvas pixel output is not tested.

- [ ] **Step 1: Write the failing test**

`packages/ui/test/viewport.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { fitViewport, worldToScreen } from '../src/viewport.js';

describe('fitViewport', () => {
  it('fills a canvas of matching aspect ratio exactly', () => {
    const v = fitViewport(1000, 600, 500, 300);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.offsetX).toBeCloseTo(0);
    expect(v.offsetY).toBeCloseTo(0);
  });

  it('letterboxes horizontally when the canvas is too wide', () => {
    const v = fitViewport(1000, 600, 2000, 600);
    expect(v.scale).toBeCloseTo(1);
    expect(v.offsetX).toBeCloseTo(500);
    expect(v.offsetY).toBeCloseTo(0);
  });

  it('letterboxes vertically when the canvas is too tall', () => {
    const v = fitViewport(1000, 600, 1000, 1200);
    expect(v.scale).toBeCloseTo(1);
    expect(v.offsetX).toBeCloseTo(0);
    expect(v.offsetY).toBeCloseTo(300);
  });

  it('never scales the world beyond the canvas', () => {
    const v = fitViewport(1000, 600, 200, 900);
    expect(1000 * v.scale).toBeLessThanOrEqual(200 + 1e-9);
    expect(600 * v.scale).toBeLessThanOrEqual(900 + 1e-9);
  });

  it('returns a zero scale for a canvas with no area', () => {
    expect(fitViewport(1000, 600, 0, 0).scale).toBe(0);
  });
});

describe('worldToScreen', () => {
  it('maps the world origin to the viewport offset', () => {
    const v = fitViewport(1000, 600, 2000, 600);
    expect(worldToScreen(v, 0, 0)).toEqual({ x: 500, y: 0 });
  });

  it('maps the far corner to the opposite edge of the fitted box', () => {
    const v = fitViewport(1000, 600, 500, 300);
    const corner = worldToScreen(v, 1000, 600);
    expect(corner.x).toBeCloseTo(500);
    expect(corner.y).toBeCloseTo(300);
  });

  it('maps the world centre to the canvas centre', () => {
    const v = fitViewport(1000, 600, 2000, 1200);
    const centre = worldToScreen(v, 500, 300);
    expect(centre.x).toBeCloseTo(1000);
    expect(centre.y).toBeCloseTo(600);
  });

  it('is independent of canvas size for relative positions', () => {
    const small = fitViewport(1000, 600, 500, 300);
    const large = fitViewport(1000, 600, 1000, 600);
    expect(worldToScreen(large, 250, 150).x).toBeCloseTo(
      worldToScreen(small, 250, 150).x * 2,
    );
  });
});
```

- [ ] **Step 2: Run it and verify it fails**

Run: `npx vitest run packages/ui/test/viewport.test.ts`
Expected: FAIL — cannot resolve `../src/viewport.js`.

- [ ] **Step 3: Implement the viewport**

`packages/ui/src/viewport.ts`:

```ts
export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Letterboxed fit: the world keeps its aspect ratio and is centred in the
 * canvas, so the simulation never depends on window size.
 */
export function fitViewport(
  worldWidth: number,
  worldHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(canvasWidth / worldWidth, canvasHeight / worldHeight);
  return {
    scale,
    offsetX: (canvasWidth - worldWidth * scale) / 2,
    offsetY: (canvasHeight - worldHeight * scale) / 2,
  };
}

export function worldToScreen(
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: viewport.offsetX + x * viewport.scale,
    y: viewport.offsetY + y * viewport.scale,
  };
}
```

- [ ] **Step 4: Run it and verify it passes**

Run: `npx vitest run packages/ui/test/viewport.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Implement the renderer**

`packages/ui/src/renderer.ts`:

```ts
import type { Snapshot } from '@thrive/core';
import type { Viewport } from './viewport.js';
import { worldToScreen } from './viewport.js';

const MALE = '#4a90d9';
const FEMALE = '#e0709f';
const BOND = 'rgba(255, 255, 255, 0.35)';
const WORLD_FILL = '#11161d';
const WORLD_EDGE = '#39424f';
const OLDEST_AGE = 95;

/** Young to old, blue-green through amber, when the age overlay is on. */
function ageColor(age: number): string {
  const t = Math.min(1, Math.max(0, age / OLDEST_AGE));
  const hue = 170 - 150 * t;
  return 'hsl(' + hue.toFixed(0) + ', 70%, 60%)';
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  snapshot: Snapshot,
  viewport: Viewport,
  options: { colorByAge: boolean },
): void {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const origin = worldToScreen(viewport, 0, 0);
  const width = snapshot.worldWidth * viewport.scale;
  const height = snapshot.worldHeight * viewport.scale;

  ctx.fillStyle = WORLD_FILL;
  ctx.fillRect(origin.x, origin.y, width, height);
  ctx.strokeStyle = WORLD_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(origin.x + 0.5, origin.y + 0.5, width - 1, height - 1);

  const radius = Math.max(1, snapshot.agentRadius * viewport.scale);
  const positions = new Map<number, { x: number; y: number }>();
  for (const agent of snapshot.agents) {
    positions.set(agent.id, worldToScreen(viewport, agent.x, agent.y));
  }

  // Bond lines first, so dots sit on top of them.
  ctx.strokeStyle = BOND;
  ctx.lineWidth = Math.max(1, radius * 0.4);
  ctx.beginPath();
  for (const agent of snapshot.agents) {
    if (agent.partnerId === null || agent.id > agent.partnerId) continue;
    const from = positions.get(agent.id);
    const to = positions.get(agent.partnerId);
    if (from === undefined || to === undefined) continue;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();

  for (const agent of snapshot.agents) {
    const point = positions.get(agent.id);
    if (point === undefined) continue;
    ctx.fillStyle = options.colorByAge
      ? ageColor(agent.age)
      : agent.gender === 'male'
        ? MALE
        : FEMALE;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/ui/src/viewport.ts packages/ui/src/renderer.ts packages/ui/test/viewport.test.ts
git commit -m "feat(ui): letterboxed viewport mapping and canvas renderer"
```

---

## Task 16: Controls, stats panel, chart, and the running application

**Files:**
- Create: `packages/ui/index.html`, `packages/ui/vite.config.ts`, `packages/ui/src/styles.css`
- Create: `packages/ui/src/chart.ts`, `packages/ui/src/statsPanel.ts`, `packages/ui/src/controls.ts`, `packages/ui/src/main.ts`

**Interfaces:**
- Consumes: `SimClient` (Task 14), `drawScene`, `fitViewport` (Task 15), `DEFAULT_CONFIG`, `StatsSample` (Tasks 2, 7)
- Produces: the running application. No new exported interface.

Changing configuration requires a reset, per the design — the editor applies its values only through the reset button, never to a running simulation.

- [ ] **Step 1: Create the shell**

`packages/ui/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Thrive</title>
  </head>
  <body>
    <main>
      <section class="stage">
        <canvas id="world"></canvas>
        <p id="status" class="status" hidden></p>
      </section>
      <aside class="panel">
        <section class="controls">
          <div class="row">
            <button id="play">Play</button>
            <button id="stepYear">Step 1 year</button>
            <button id="reset">Reset</button>
          </div>
          <label>
            Seconds per year <output id="speedValue"></output>
            <input id="speed" type="range" min="0.05" max="5" step="0.05" />
          </label>
          <label>
            Seed <input id="seed" type="number" value="42" />
          </label>
          <div class="row">
            <label>
              Run to year <input id="targetYear" type="number" value="200" />
            </label>
            <button id="runTo">Go</button>
            <button id="cancel" disabled>Cancel</button>
          </div>
          <label class="inline">
            <input id="colorByAge" type="checkbox" /> Colour by age
          </label>
          <div class="row">
            <button id="exportCsv">Export CSV</button>
          </div>
          <details>
            <summary>Configuration (applied on reset)</summary>
            <textarea id="config" spellcheck="false" rows="18"></textarea>
            <p id="configError" class="error" hidden></p>
          </details>
        </section>
        <section class="stats">
          <dl id="statsNumbers"></dl>
          <canvas id="chart" height="160"></canvas>
        </section>
      </aside>
    </main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`packages/ui/vite.config.ts`:

```ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true, port: 5173 },
  build: { target: 'es2022' },
});
```

`packages/ui/src/styles.css`:

```css
:root {
  color-scheme: dark;
  --bg: #0b0e13;
  --panel: #151b24;
  --text: #dfe6ef;
  --muted: #8a97a8;
  --accent: #4a90d9;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 14px/1.5 system-ui, sans-serif;
}

main { display: flex; height: 100vh; }

.stage { position: relative; flex: 1; min-width: 0; }
.stage canvas { display: block; width: 100%; height: 100%; }

.status {
  position: absolute;
  top: 1rem;
  left: 50%;
  transform: translateX(-50%);
  margin: 0;
  padding: 0.4rem 0.9rem;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.6);
  color: var(--text);
}

.panel {
  width: 320px;
  padding: 1rem;
  overflow-y: auto;
  background: var(--panel);
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}

.row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
label { display: block; margin-bottom: 0.75rem; color: var(--muted); }
label.inline { display: flex; gap: 0.5rem; align-items: center; }
input[type='number'] { width: 6rem; }
input[type='range'] { width: 100%; }

button {
  padding: 0.35rem 0.75rem;
  border: 1px solid #2c3644;
  border-radius: 4px;
  background: #1d2530;
  color: var(--text);
  cursor: pointer;
}
button:disabled { opacity: 0.45; cursor: default; }
button:hover:not(:disabled) { border-color: var(--accent); }

textarea {
  width: 100%;
  font-family: ui-monospace, monospace;
  font-size: 12px;
  background: #0d1218;
  color: var(--text);
  border: 1px solid #2c3644;
  border-radius: 4px;
}

dl { display: grid; grid-template-columns: 1fr auto; gap: 0.15rem 1rem; margin: 0; }
dt { color: var(--muted); }
dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }

.error { color: #e0709f; }
#chart { width: 100%; margin-top: 0.75rem; }
```

- [ ] **Step 2: Implement the chart and the stats panel**

`packages/ui/src/chart.ts`:

```ts
import type { StatsSample } from '@thrive/core';

/** Population over time. Redrawn from the series on every update. */
export function drawChart(
  ctx: CanvasRenderingContext2D,
  series: StatsSample[],
): void {
  const { width, height } = ctx.canvas;
  ctx.clearRect(0, 0, width, height);

  ctx.strokeStyle = '#2c3644';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);
  if (series.length < 2) return;

  const peak = Math.max(1, ...series.map((s) => s.population));
  const lastYear = Math.max(1, series[series.length - 1]!.year);

  ctx.strokeStyle = '#4a90d9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  series.forEach((sample, index) => {
    const x = (sample.year / lastYear) * (width - 2) + 1;
    const y = height - 1 - (sample.population / peak) * (height - 2);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  ctx.fillStyle = '#8a97a8';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('peak ' + String(peak), 6, 14);
  ctx.fillText('year ' + lastYear.toFixed(0), width - 60, height - 6);
}
```

`packages/ui/src/statsPanel.ts`:

```ts
import type { StatsSample } from '@thrive/core';

const ROWS: Array<[string, (s: StatsSample) => string]> = [
  ['Year', (s) => s.year.toFixed(0)],
  ['Population', (s) => String(s.population)],
  ['Male / female', (s) => s.males + ' / ' + s.females],
  ['Active unions', (s) => String(s.activeUnions)],
  ['Births this year', (s) => String(s.births)],
  ['Deaths this year', (s) => String(s.deaths)],
  ['Mean age', (s) => s.meanAge.toFixed(1)],
  ['Suppressed births', (s) => String(s.suppressedBirths)],
];

export function renderStats(
  target: HTMLElement,
  sample: StatsSample | null,
): void {
  target.textContent = '';
  if (sample === null) return;

  for (const [label, read] of ROWS) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = read(sample);
    target.append(dt, dd);
  }
}
```

- [ ] **Step 3: Implement the configuration editor**

`packages/ui/src/controls.ts`:

```ts
import { DEFAULT_CONFIG, validateConfig } from '@thrive/core';
import type { SimConfig } from '@thrive/core';

/**
 * The configuration editor. Values apply only on reset — editing a running
 * simulation would break reproducibility, which the design forbids.
 */
export class ConfigEditor {
  constructor(
    private readonly textarea: HTMLTextAreaElement,
    private readonly errorEl: HTMLElement,
  ) {
    this.textarea.value = JSON.stringify(DEFAULT_CONFIG, null, 2);
  }

  /** Returns the edited config, or null if it is unparseable or invalid. */
  read(): SimConfig | null {
    try {
      const parsed = JSON.parse(this.textarea.value) as SimConfig;
      validateConfig(parsed);
      this.clearError();
      return parsed;
    } catch (error) {
      this.showError(
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private showError(message: string): void {
    this.errorEl.textContent = message;
    this.errorEl.hidden = false;
  }

  private clearError(): void {
    this.errorEl.hidden = true;
    this.errorEl.textContent = '';
  }
}

export function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error('Missing element #' + id);
  return element as T;
}
```

- [ ] **Step 4: Wire the application together**

`packages/ui/src/main.ts`:

```ts
import './styles.css';
import type { Snapshot, StatsSample } from '@thrive/core';
import { SimClient } from './simClient.js';
import { fitViewport } from './viewport.js';
import { drawScene } from './renderer.js';
import { drawChart } from './chart.js';
import { renderStats } from './statsPanel.js';
import { ConfigEditor, requireElement } from './controls.js';

const worldCanvas = requireElement<HTMLCanvasElement>('world');
const chartCanvas = requireElement<HTMLCanvasElement>('chart');
const statusEl = requireElement<HTMLParagraphElement>('status');
const statsEl = requireElement<HTMLElement>('statsNumbers');
const playButton = requireElement<HTMLButtonElement>('play');
const cancelButton = requireElement<HTMLButtonElement>('cancel');
const speedInput = requireElement<HTMLInputElement>('speed');
const speedValue = requireElement<HTMLOutputElement>('speedValue');
const seedInput = requireElement<HTMLInputElement>('seed');
const targetYearInput = requireElement<HTMLInputElement>('targetYear');
const colorByAgeInput = requireElement<HTMLInputElement>('colorByAge');

const editor = new ConfigEditor(
  requireElement<HTMLTextAreaElement>('config'),
  requireElement<HTMLElement>('configError'),
);

const worldCtx = worldCanvas.getContext('2d');
const chartCtx = chartCanvas.getContext('2d');
if (worldCtx === null || chartCtx === null) {
  throw new Error('Canvas 2D context unavailable');
}

let latestSnapshot: Snapshot | null = null;
let series: StatsSample[] = [];
let running = false;
let frameRequested = false;

function setStatus(message: string | null): void {
  statusEl.hidden = message === null;
  statusEl.textContent = message ?? '';
}

function resizeCanvases(): void {
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [worldCanvas, chartCanvas]) {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }
  requestDraw();
}

/**
 * Draws at most once per animation frame from whatever the latest snapshot is.
 * If the simulation outruns the display, frames are skipped, never queued.
 */
function requestDraw(): void {
  if (frameRequested) return;
  frameRequested = true;
  requestAnimationFrame(() => {
    frameRequested = false;
    if (latestSnapshot === null) return;
    const viewport = fitViewport(
      latestSnapshot.worldWidth,
      latestSnapshot.worldHeight,
      worldCanvas.width,
      worldCanvas.height,
    );
    drawScene(worldCtx, latestSnapshot, viewport, {
      colorByAge: colorByAgeInput.checked,
    });
    drawChart(chartCtx, series);
  });
}

const client = new SimClient({
  onSnapshot(snapshot, latest, isRunning) {
    latestSnapshot = snapshot;
    running = isRunning;
    playButton.textContent = isRunning ? 'Pause' : 'Play';
    if (latest !== null) {
      const last = series[series.length - 1];
      if (last === undefined || latest.year > last.year) series.push(latest);
      else if (latest.year === last.year) series[series.length - 1] = latest;
      renderStats(statsEl, latest);
    }
    if (snapshot.atCapacity) {
      setStatus('At capacity — births are being suppressed');
    } else if (!snapshot.extinct) {
      setStatus(null);
    }
    requestDraw();
  },
  onProgress(year, targetYear) {
    cancelButton.disabled = false;
    setStatus(
      'Fast-forwarding: year ' + year.toFixed(0) + ' of ' + String(targetYear),
    );
  },
  onProgressDone() {
    cancelButton.disabled = true;
    setStatus(null);
  },
  onStats(format, data) {
    const blob = new Blob([data], {
      type: format === 'csv' ? 'text/csv' : 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'thrive-stats.' + format;
    link.click();
    URL.revokeObjectURL(url);
  },
  onExtinct(year) {
    setStatus('Extinct at year ' + year.toFixed(0));
    playButton.textContent = 'Play';
  },
  onError(message) {
    setStatus('Error: ' + message);
  },
});

function currentSeed(): number {
  const seed = Number(seedInput.value);
  return Number.isFinite(seed) ? seed : 1;
}

function start(): void {
  const config = editor.read();
  if (config === null) return;
  series = [];
  setStatus(null);
  client.init(config, currentSeed(), Number(speedInput.value));
}

playButton.addEventListener('click', () => {
  if (running) client.pause();
  else client.play();
});

requireElement<HTMLButtonElement>('stepYear').addEventListener('click', () => {
  client.stepYear();
});

requireElement<HTMLButtonElement>('reset').addEventListener('click', () => {
  const config = editor.read();
  if (config === null) return;
  series = [];
  setStatus(null);
  client.reset(config, currentSeed());
});

requireElement<HTMLButtonElement>('runTo').addEventListener('click', () => {
  const target = Number(targetYearInput.value);
  if (Number.isFinite(target)) client.runToYear(target);
});

cancelButton.addEventListener('click', () => {
  client.cancel();
});

requireElement<HTMLButtonElement>('exportCsv').addEventListener('click', () => {
  client.requestStats('csv');
});

speedInput.addEventListener('input', () => {
  speedValue.value = Number(speedInput.value).toFixed(2) + ' s';
  client.setSpeed(Number(speedInput.value));
});

colorByAgeInput.addEventListener('change', requestDraw);
window.addEventListener('resize', resizeCanvases);

speedInput.value = '1';
speedValue.value = '1.00 s';
resizeCanvases();
start();
```

- [ ] **Step 5: Run the whole suite**

Run: `npx vitest run`
Expected: PASS, every package.

- [ ] **Step 6: Verify the application in a browser**

Run: `npm run dev --workspace @thrive/ui`

Open the printed URL and confirm each of these, which together cover the design's interface and failure-mode requirements:

1. Dots appear in a bordered rectangle and move, bouncing off walls and each other.
2. Pressing Play/Pause starts and stops motion; the button label follows the state.
3. Moving the seconds-per-year slider visibly changes how fast dots move.
4. Within a few simulated decades, linked pairs appear (two dots joined by a line, travelling together).
5. The stats panel updates each year and the population chart draws a curve.
6. "Colour by age" recolours the dots from blue-green to amber.
7. Entering year 300 and pressing Go fast-forwards with a visible progress message; Cancel stops it mid-run.
8. Export CSV downloads a file whose first line matches the CSV header.
9. Resetting with the same seed reproduces the same opening arrangement; a different seed does not.
10. Breaking the config JSON (delete a brace) and pressing Reset shows an error and leaves the run untouched.
11. Setting `maxAgents` low with a high `birthChancePerYear` shows the capacity message.
12. Letting a run go long enough shows the extinction message rather than a frozen canvas.

Fix anything that fails before committing. If behaviour 4 never occurs, check `union.chance` and the fertility windows before changing code.

- [ ] **Step 7: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): controls, stats panel, population chart and app wiring"
```

---

## Task 17: Docker delivery

**Files:**
- Create: `docker/Dockerfile.web`, `docker/Dockerfile.cli`, `docker/nginx.conf`
- Create: `docker-compose.yml`, `.dockerignore`
- Create: `README.md`
- Modify: root `package.json` — add the `build` script

**Interfaces:**
- Consumes: the built UI (Task 16) and the CLI (Task 12)
- Produces: `docker compose up` serving the app, and `docker compose run --rm sim --years 500 --seed 42` producing CSV

- [ ] **Step 1: Add the build script**

Add to the root `package.json` scripts:

```json
"build": "npm run build --workspace @thrive/ui"
```

- [ ] **Step 2: Write the Docker files**

`.dockerignore`:

```
node_modules
**/node_modules
**/dist
.git
*.tsbuildinfo
```

`docker/Dockerfile.web`:

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
COPY packages/ui/package.json packages/ui/
COPY packages/cli/package.json packages/cli/
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine AS serve
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/packages/ui/dist /usr/share/nginx/html
EXPOSE 80
```

`docker/nginx.conf`:

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

`docker/Dockerfile.cli`:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/worker/package.json packages/worker/
COPY packages/ui/package.json packages/ui/
COPY packages/cli/package.json packages/cli/
RUN npm ci
COPY . .
ENTRYPOINT ["npx", "tsx", "packages/cli/src/index.ts"]
```

`docker-compose.yml`:

```yaml
services:
  web:
    build:
      context: .
      dockerfile: docker/Dockerfile.web
    ports:
      - "8080:80"

  sim:
    build:
      context: .
      dockerfile: docker/Dockerfile.cli
    volumes:
      - ./out:/out
    profiles: ["cli"]
```

- [ ] **Step 3: Write the README**

`README.md`:

```markdown
# Thrive

A seeded, reproducible population simulation. Agents move inside a closed
rectangle, bounce off each other and the walls, age, form unions, produce
offspring, and die of old age.

- Design: `docs/superpowers/specs/2026-09-19-thrive-simulation-design.md`
- Plan: `docs/superpowers/plans/2026-09-19-thrive-simulation.md`

## Packages

| Package | Responsibility |
| --- | --- |
| `packages/core` | The simulation. Pure, seeded, no DOM, timers or I/O. |
| `packages/worker` | The only place wall-clock time exists. |
| `packages/ui` | Canvas renderer, controls, live statistics. |
| `packages/cli` | Headless runs and parameter sweeps. |

## Local development

```bash
npm install
npm test
npm run dev --workspace @thrive/ui
```

## Docker

```bash
docker compose up web
```

The application is then served at http://localhost:8080.

```bash
mkdir -p out
docker compose run --rm sim --years 500 --seed 42 --out /out/run.csv
```

## Reproducibility

A run is fully determined by its configuration and its seed. The same pair
always produces the same result, in the browser and in the CLI alike. The
golden-run fixture at `packages/cli/test/fixtures/` freezes one such run; if a
change alters simulation behaviour, that test fails.

To re-baseline the fixture deliberately after an intended behaviour change:

```bash
npm run golden:update
```
```

- [ ] **Step 4: Verify the web image**

Run: `docker compose up --build web`
Then open http://localhost:8080 and confirm the simulation renders and runs, exactly as in Task 16.
Expected: the same application, served from nginx.

Stop it with `docker compose down`.

- [ ] **Step 5: Verify the CLI image**

Run:

```bash
mkdir -p out && docker compose run --rm sim --years 200 --seed 42 --out /out/run.csv
```

Expected: `out/run.csv` exists, its first line matches the CSV header, and it has 202 lines in total (header plus years 0 through 200). Alongside it, `out/run.csv.config.json` records the seed, the year count and the full configuration, so the results are never separated from the parameters that produced them.

Verify the container's output matches the host's, which is the cross-environment determinism check:

```bash
npx tsx packages/cli/src/index.ts --years 200 --seed 42 --out /tmp/host-run.csv
diff /tmp/host-run.csv out/run.csv && echo "identical"
```

Expected: `identical`.

- [ ] **Step 6: Commit**

```bash
git add docker docker-compose.yml .dockerignore README.md package.json
git commit -m "feat: docker delivery for the web app and the headless runner"
```

---

## Done

At this point the spec is fully implemented: a pure seeded core with movement,
collisions, aging, death, unions, bonded movement, births and a capacity
guardrail; a worker owning all time; a canvas UI with controls, live stats and
a chart; a headless CLI with a golden-run regression fixture; and Docker
delivery for both surfaces.

Explicitly not built, per the design's out-of-scope list: resources, density
mortality, genetics, migration, player interventions, multiple regions, run
persistence, and any performance work beyond the spatial grid.
