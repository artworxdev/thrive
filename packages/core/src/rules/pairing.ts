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
