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

  it('gives a solo body to an agent whose partner is missing', () => {
    const a = make(3, 100, 100);
    a.partnerId = 99;
    const bodies = buildBodies([a], DEFAULT_CONFIG);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.agentId).toBe(3);
    expect(bodies[0]!.radius).toBe(DEFAULT_CONFIG.agentRadius);
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
