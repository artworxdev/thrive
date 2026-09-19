export { Simulation } from './simulation.js';
export {
  DEFAULT_CONFIG,
  validateConfig,
  deriveSubStepsPerYear,
  ConfigError,
} from './config.js';
export type { SimConfig, AgeWindow } from './config.js';
export { STATS_CSV_HEADER, toCsv, toJson } from './stats.js';
export { UnionRegistry } from './union.js';
export type { Union } from './union.js';
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
