import type { RngStream } from '../rng.js';
import type { SimConfig } from '../config.js';
import type { Gender } from '../types.js';

/** Rejection attempts before falling back to clamping. */
const MAX_ATTEMPTS = 32;

/**
 * Truncated normal lifespan. Rejection sampling keeps the distribution shape
 * honest for sane configurations; the clamp fallback guarantees termination
 * for configurations whose mass lies outside the bounds.
 */
export function sampleLifespan(
  stream: RngStream,
  config: SimConfig,
  gender: Gender,
): number {
  const { min, max, stdDev } = config.lifespan;
  const mean =
    gender === 'male' ? config.lifespan.meanMale : config.lifespan.meanFemale;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const value = stream.normal(mean, stdDev);
    if (value >= min && value <= max) return value;
  }
  return Math.min(max, Math.max(min, stream.normal(mean, stdDev)));
}
