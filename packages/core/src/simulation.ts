import type {
  AgentId,
  Command,
  CommandResult,
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
import { StatsRecorder, computeSample, toCsv, toJson } from './stats.js';
import { UnionRegistry } from './union.js';
import type { Union } from './union.js';
import { canFormUnion } from './rules/pairing.js';
import { createOffspring } from './rules/birth.js';

export class Simulation {
  protected readonly config: SimConfig;
  protected rng: Rng;
  protected readonly subStepsPerYear: number;
  protected readonly grid: SpatialGrid;
  protected recorder = new StatsRecorder();

  /** Kept in ascending id order at all times. */
  protected agents: Agent[];
  protected byId = new Map<AgentId, Agent>();
  protected nextAgentId: number;
  protected unions = new UnionRegistry();

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

  protected expireUnions(): void {
    const year = this.year;
    for (const union of this.unions.all()) {
      if (union.endYear <= year) this.dissolve(union, null);
    }
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

  protected decrementCooldowns(): void {
    for (const agent of this.agents) {
      if (agent.cooldownRemaining > 0) {
        agent.cooldownRemaining = Math.max(0, agent.cooldownRemaining - 1);
      }
    }
  }

  protected activeUnionCount(): number {
    return this.unions.size;
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
