/** A stalled or backgrounded tab must not fast-forward on resume. */
export const MAX_CATCH_UP_YEARS = 5;

export class Clock {
  private rate: number;

  constructor(secondsPerYear: number) {
    this.rate = 0;
    this.setSpeed(secondsPerYear);
  }

  setSpeed(secondsPerYear: number): void {
    if (!Number.isFinite(secondsPerYear) || secondsPerYear <= 0) {
      throw new Error('secondsPerYear must be a positive number');
    }
    this.rate = secondsPerYear;
  }

  get secondsPerYear(): number {
    return this.rate;
  }

  /** Simulated years to advance for the given wall-clock elapsed time. */
  advance(elapsedMs: number): number {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
    const years = elapsedMs / 1000 / this.rate;
    return Math.min(MAX_CATCH_UP_YEARS, years);
  }
}
