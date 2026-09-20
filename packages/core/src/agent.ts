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
  /**
   * The agent's own speed, sampled once at birth and never overwritten.
   * `speed` is temporarily set equal to a bonded leader's speed while the
   * agent is a follower in a union; `ownSpeed` is restored to `speed` on
   * dissolution. Speed is constant for an agent's lifetime per the design.
   */
  ownSpeed: number;
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
  const speed = movement.range(config.speed.min, config.speed.max);

  return {
    id,
    gender,
    x,
    y,
    dx: Math.cos(angle),
    dy: Math.sin(angle),
    speed,
    ownSpeed: speed,
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
