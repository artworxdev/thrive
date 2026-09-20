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
