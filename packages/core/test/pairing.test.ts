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
