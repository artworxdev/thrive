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
