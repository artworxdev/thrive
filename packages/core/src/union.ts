import type { AgentId, UnionId } from './types.js';

export interface Union {
  id: UnionId;
  /** Always the lower agent id. */
  a: AgentId;
  /** Always the higher agent id. */
  b: AgentId;
  startYear: number;
  /** The year at which this union dissolves on its own. */
  endYear: number;
}

export class UnionRegistry {
  private readonly unions = new Map<UnionId, Union>();
  private nextId = 0;

  create(
    a: AgentId,
    b: AgentId,
    startYear: number,
    durationYears: number,
  ): Union {
    const union: Union = {
      id: this.nextId++,
      a: Math.min(a, b),
      b: Math.max(a, b),
      startYear,
      endYear: startYear + durationYears,
    };
    this.unions.set(union.id, union);
    return union;
  }

  get(id: UnionId): Union | undefined {
    return this.unions.get(id);
  }

  /** Ascending union id order, so iteration is always stable. */
  all(): Union[] {
    return [...this.unions.values()].sort((x, y) => x.id - y.id);
  }

  remove(id: UnionId): void {
    this.unions.delete(id);
  }

  get size(): number {
    return this.unions.size;
  }

  clear(): void {
    this.unions.clear();
    this.nextId = 0;
  }
}
