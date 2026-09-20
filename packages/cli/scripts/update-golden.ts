import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { Simulation, DEFAULT_CONFIG } from '@thrive/core';
import { GOLDEN_PATH, GOLDEN_SEED, GOLDEN_YEARS } from '../test/golden-spec.js';

const sim = Simulation.init(DEFAULT_CONFIG, GOLDEN_SEED);
sim.command({ type: 'runToYear', year: GOLDEN_YEARS });

mkdirSync(dirname(GOLDEN_PATH), { recursive: true });
writeFileSync(GOLDEN_PATH, JSON.stringify(sim.stats(), null, 2) + '\n', 'utf8');
process.stdout.write('Wrote ' + GOLDEN_PATH + '\n');
