import type {
  AgentId,
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
import { StatsRecorder, computeSample } from './stats.js';

export class Simulation {
  protected readonly config: SimConfig;
  protected readonly rng: Rng;
  protected readonly subStepsPerYear: number;
  protected readonly grid: SpatialGrid;
  protected readonly recorder = new StatsRecorder();

  /** Kept in ascending id order at all times. */
  protected agents: Agent[];
  protected byId = new Map<AgentId, Agent>();
  protected nextAgentId: number;

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

  /** Extension point — Task 9 implements union formation here. */
  protected onEncounters(_encounters: Array<[AgentId, AgentId]>): void {
    // No reproduction in this task.
  }

  /** Extension point — Task 10 implements union expiry and births here. */
  protected annualEvents(): void {
    // No reproduction in this task.
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

  /** Extension point — Task 10 releases the surviving partner here. */
  protected onDeath(_agent: Agent): void {
    // No unions in this task.
  }

  protected decrementCooldowns(): void {
    for (const agent of this.agents) {
      if (agent.cooldownRemaining > 0) {
        agent.cooldownRemaining = Math.max(0, agent.cooldownRemaining - 1);
      }
    }
  }

  protected activeUnionCount(): number {
    return 0;
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
