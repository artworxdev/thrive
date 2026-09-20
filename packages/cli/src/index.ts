import { readFileSync, writeFileSync } from 'node:fs';
import { Simulation, DEFAULT_CONFIG, validateConfig } from '@thrive/core';
import type { SimConfig } from '@thrive/core';
import { parseArgs } from './args.js';
import type { CliOptions } from './args.js';

export function loadConfig(configPath: string | null): SimConfig {
  if (configPath === null) return structuredClone(DEFAULT_CONFIG);
  const merged = {
    ...structuredClone(DEFAULT_CONFIG),
    ...(JSON.parse(readFileSync(configPath, 'utf8')) as Partial<SimConfig>),
  } as SimConfig;
  validateConfig(merged);
  return merged;
}

export function runSimulation(options: CliOptions, config: SimConfig): string {
  const sim = Simulation.init(config, options.seed);
  sim.command({ type: 'runToYear', year: options.years });
  const result = sim.command({
    type: 'exportStats',
    format: options.format,
  });
  if (result.type !== 'stats') throw new Error('expected a stats result');
  return result.data;
}

function main(): void {
  try {
    const options = parseArgs(process.argv.slice(2));
    const config = loadConfig(options.configPath);
    const output = runSimulation(options, config);
    if (options.outPath === null) {
      process.stdout.write(output);
    } else {
      writeFileSync(options.outPath, output, 'utf8');
      // The design requires the config to travel with any run's results, so a
      // CSV on disk is never separated from the parameters that produced it.
      writeFileSync(
        options.outPath + '.config.json',
        JSON.stringify({ seed: options.seed, years: options.years, config }, null, 2) +
          '\n',
        'utf8',
      );
    }
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : String(error)) + '\n',
    );
    process.exitCode = 1;
  }
}

if (process.env.VITEST === undefined) main();
