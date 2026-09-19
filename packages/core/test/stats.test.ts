import { describe, it, expect } from 'vitest';
import { Rng } from '../src/rng.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { createAgent } from '../src/agent.js';
import type { Agent } from '../src/agent.js';
import {
  computeSample,
  StatsRecorder,
  toCsv,
  toJson,
  STATS_CSV_HEADER,
} from '../src/stats.js';

function agentAged(id: number, gender: 'male' | 'female', age: number): Agent {
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

describe('computeSample', () => {
  const agents = [
    agentAged(0, 'male', 10),
    agentAged(1, 'male', 30),
    agentAged(2, 'female', 50),
    agentAged(3, 'female', 95),
  ];
  const sample = computeSample({
    year: 0,
    agents,
    activeUnions: 1,
    births: 2,
    deaths: 3,
    suppressedBirths: 4,
  });

  it('counts the population and each gender', () => {
    expect(sample.population).toBe(4);
    expect(sample.males).toBe(2);
    expect(sample.females).toBe(2);
  });

  it('carries the event counts through', () => {
    expect(sample.births).toBe(2);
    expect(sample.deaths).toBe(3);
    expect(sample.activeUnions).toBe(1);
    expect(sample.suppressedBirths).toBe(4);
  });

  it('computes the mean age', () => {
    expect(sample.meanAge).toBeCloseTo((10 + 30 + 50 + 95) / 4);
  });

  it('buckets ages by decade with a 90-plus final bucket', () => {
    expect(sample.ageBuckets).toHaveLength(10);
    expect(sample.ageBuckets[1]).toBe(1);
    expect(sample.ageBuckets[3]).toBe(1);
    expect(sample.ageBuckets[5]).toBe(1);
    expect(sample.ageBuckets[9]).toBe(1);
    expect(sample.ageBuckets.reduce((a, b) => a + b, 0)).toBe(4);
  });

  it('reports a mean age of zero for an empty population', () => {
    const empty = computeSample({
      year: 5,
      agents: [],
      activeUnions: 0,
      births: 0,
      deaths: 7,
      suppressedBirths: 0,
    });
    expect(empty.population).toBe(0);
    expect(empty.meanAge).toBe(0);
    expect(empty.ageBuckets.reduce((a, b) => a + b, 0)).toBe(0);
  });
});

describe('StatsRecorder', () => {
  it('starts empty', () => {
    const recorder = new StatsRecorder();
    expect(recorder.series()).toEqual([]);
    expect(recorder.latest()).toBeNull();
  });

  it('keeps samples in recording order and exposes the latest', () => {
    const recorder = new StatsRecorder();
    const make = (year: number) =>
      computeSample({
        year,
        agents: [],
        activeUnions: 0,
        births: 0,
        deaths: 0,
        suppressedBirths: 0,
      });
    recorder.record(make(0));
    recorder.record(make(1));
    expect(recorder.series().map((s) => s.year)).toEqual([0, 1]);
    expect(recorder.latest()?.year).toBe(1);
  });
});

describe('serialization', () => {
  const series = [
    computeSample({
      year: 0,
      agents: [agentAged(0, 'male', 20)],
      activeUnions: 0,
      births: 0,
      deaths: 0,
      suppressedBirths: 0,
    }),
  ];

  it('writes a header row followed by one row per sample', () => {
    const lines = toCsv(series).trim().split('\n');
    expect(lines[0]).toBe(STATS_CSV_HEADER);
    expect(lines).toHaveLength(2);
  });

  it('writes one CSV column per header column', () => {
    const lines = toCsv(series).trim().split('\n');
    const headerColumns = STATS_CSV_HEADER.split(',').length;
    expect(lines[1]!.split(',')).toHaveLength(headerColumns);
  });

  it('round-trips through JSON', () => {
    expect(JSON.parse(toJson(series))).toEqual(series);
  });

  it('writes only a header for an empty series', () => {
    expect(toCsv([]).trim()).toBe(STATS_CSV_HEADER);
  });
});
