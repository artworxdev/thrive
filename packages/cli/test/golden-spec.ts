import { fileURLToPath } from 'node:url';

export const GOLDEN_SEED = 42;
export const GOLDEN_YEARS = 200;
export const GOLDEN_PATH = fileURLToPath(
  new URL('./fixtures/golden-seed42-200y.json', import.meta.url),
);
