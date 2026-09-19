import { describe, it, expect } from 'vitest';
import { parseArgs } from '../src/args.js';

describe('parseArgs', () => {
  it('parses years and seed', () => {
    const options = parseArgs(['--years', '500', '--seed', '42']);
    expect(options.years).toBe(500);
    expect(options.seed).toBe(42);
  });

  it('defaults the seed to one', () => {
    expect(parseArgs(['--years', '10']).seed).toBe(1);
  });

  it('defaults the format to csv', () => {
    expect(parseArgs(['--years', '10']).format).toBe('csv');
  });

  it('accepts json as a format', () => {
    expect(parseArgs(['--years', '10', '--format', 'json']).format).toBe(
      'json',
    );
  });

  it('rejects an unknown format', () => {
    expect(() => parseArgs(['--years', '10', '--format', 'xml'])).toThrow(
      /format/,
    );
  });

  it('requires years', () => {
    expect(() => parseArgs([])).toThrow(/--years/);
  });

  it('rejects non-numeric years', () => {
    expect(() => parseArgs(['--years', 'many'])).toThrow(/--years/);
  });

  it('rejects zero or negative years', () => {
    expect(() => parseArgs(['--years', '0'])).toThrow(/--years/);
    expect(() => parseArgs(['--years', '-5'])).toThrow(/--years/);
  });

  it('rejects an unknown flag', () => {
    expect(() => parseArgs(['--years', '10', '--colour', 'red'])).toThrow(
      /--colour/,
    );
  });

  it('rejects a flag with no value', () => {
    expect(() => parseArgs(['--years'])).toThrow(/--years/);
  });

  it('defaults the config and output paths to null', () => {
    const options = parseArgs(['--years', '10']);
    expect(options.configPath).toBeNull();
    expect(options.outPath).toBeNull();
  });

  it('parses the config and output paths', () => {
    const options = parseArgs([
      '--years',
      '10',
      '--config',
      'a.json',
      '--out',
      'b.csv',
    ]);
    expect(options.configPath).toBe('a.json');
    expect(options.outPath).toBe('b.csv');
  });
});
