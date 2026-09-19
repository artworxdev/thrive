import type { StatsSample, StatsSeries } from './types.js';
import type { Agent } from './agent.js';
import { ageOf } from './agent.js';

const BUCKET_COUNT = 10;

export const STATS_CSV_HEADER =
  'year,population,males,females,births,deaths,activeUnions,meanAge,' +
  'suppressedBirths,age0,age10,age20,age30,age40,age50,age60,age70,age80,age90plus';

export function computeSample(params: {
  year: number;
  agents: Agent[];
  activeUnions: number;
  births: number;
  deaths: number;
  suppressedBirths: number;
}): StatsSample {
  const { year, agents, activeUnions, births, deaths, suppressedBirths } =
    params;

  let males = 0;
  let ageTotal = 0;
  const ageBuckets = new Array<number>(BUCKET_COUNT).fill(0);

  for (const agent of agents) {
    if (agent.gender === 'male') males++;
    const age = ageOf(agent, year);
    ageTotal += age;
    const bucket = Math.min(BUCKET_COUNT - 1, Math.max(0, Math.floor(age / 10)));
    ageBuckets[bucket] = (ageBuckets[bucket] ?? 0) + 1;
  }

  return {
    year,
    population: agents.length,
    males,
    females: agents.length - males,
    births,
    deaths,
    activeUnions,
    meanAge: agents.length === 0 ? 0 : ageTotal / agents.length,
    ageBuckets,
    suppressedBirths,
  };
}

export class StatsRecorder {
  private readonly samples: StatsSample[] = [];

  record(sample: StatsSample): void {
    this.samples.push(sample);
  }

  series(): StatsSeries {
    return this.samples;
  }

  latest(): StatsSample | null {
    return this.samples.length === 0
      ? null
      : this.samples[this.samples.length - 1]!;
  }

  clear(): void {
    this.samples.length = 0;
  }
}

export function toCsv(series: StatsSeries): string {
  const rows = [STATS_CSV_HEADER];
  for (const s of series) {
    rows.push(
      [
        s.year,
        s.population,
        s.males,
        s.females,
        s.births,
        s.deaths,
        s.activeUnions,
        s.meanAge.toFixed(3),
        s.suppressedBirths,
        ...s.ageBuckets,
      ].join(','),
    );
  }
  return rows.join('\n') + '\n';
}

export function toJson(series: StatsSeries): string {
  return JSON.stringify(series, null, 2);
}
