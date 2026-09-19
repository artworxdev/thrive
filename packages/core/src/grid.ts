import type { AgentId } from './types.js';

/**
 * Uniform grid broad phase. Each cell is checked against itself and four of
 * its eight neighbours (E, SE, S, SW), which visits every adjacent cell pair
 * exactly once and so needs no de-duplication pass.
 */
export class SpatialGrid {
  private readonly cols: number;
  private readonly rows: number;
  private readonly cellSize: number;
  private readonly cells: AgentId[][];

  constructor(width: number, height: number, cellSize: number) {
    if (cellSize <= 0) throw new Error('cellSize must be greater than zero');
    this.cellSize = cellSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    this.cells = Array.from({ length: this.cols * this.rows }, () => []);
  }

  clear(): void {
    for (const cell of this.cells) cell.length = 0;
  }

  insert(id: AgentId, x: number, y: number): void {
    const col = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cellSize)));
    const row = Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.cellSize)));
    const cell = this.cells[row * this.cols + col];
    if (cell !== undefined) cell.push(id);
  }

  candidatePairs(): Array<[AgentId, AgentId]> {
    const pairs: Array<[AgentId, AgentId]> = [];
    // E, SE, S, SW — the half-neighbourhood.
    const neighbours: Array<[number, number]> = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
    ];

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const here = this.cells[row * this.cols + col];
        if (here === undefined || here.length === 0) continue;

        for (let i = 0; i < here.length; i++) {
          for (let j = i + 1; j < here.length; j++) {
            pairs.push(orderPair(here[i]!, here[j]!));
          }
        }

        for (const [dc, dr] of neighbours) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nc >= this.cols || nr < 0 || nr >= this.rows) continue;
          const other = this.cells[nr * this.cols + nc];
          if (other === undefined || other.length === 0) continue;
          for (const a of here) {
            for (const b of other) pairs.push(orderPair(a, b));
          }
        }
      }
    }
    return pairs;
  }
}

function orderPair(a: AgentId, b: AgentId): [AgentId, AgentId] {
  return a < b ? [a, b] : [b, a];
}
