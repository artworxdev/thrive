export interface CliOptions {
  years: number;
  seed: number;
  format: 'csv' | 'json';
  configPath: string | null;
  outPath: string | null;
}

export const USAGE =
  'Usage: thrive --years <n> [--seed <n>] [--format csv|json] ' +
  '[--config <path>] [--out <path>]';

export function parseArgs(argv: string[]): CliOptions {
  let years: number | null = null;
  let seed = 1;
  let format: 'csv' | 'json' = 'csv';
  let configPath: string | null = null;
  let outPath: string | null = null;

  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i]!;
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(flag + ' requires a value. ' + USAGE);
    }

    switch (flag) {
      case '--years':
        years = Number(value);
        if (!Number.isFinite(years) || years <= 0) {
          throw new Error('--years must be a positive number. ' + USAGE);
        }
        break;
      case '--seed':
        seed = Number(value);
        if (!Number.isFinite(seed)) {
          throw new Error('--seed must be a number. ' + USAGE);
        }
        break;
      case '--format':
        if (value !== 'csv' && value !== 'json') {
          throw new Error('--format must be csv or json. ' + USAGE);
        }
        format = value;
        break;
      case '--config':
        configPath = value;
        break;
      case '--out':
        outPath = value;
        break;
      default:
        throw new Error('Unknown flag ' + flag + '. ' + USAGE);
    }
  }

  if (years === null) throw new Error('--years is required. ' + USAGE);
  return { years, seed, format, configPath, outPath };
}
