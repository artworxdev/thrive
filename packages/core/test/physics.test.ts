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
