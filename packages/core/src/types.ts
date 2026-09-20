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
