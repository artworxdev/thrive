import { describe, it, expect } from 'vitest';
import { SpatialGrid } from '../src/grid.js';

describe('SpatialGrid', () => {
  it('finds a pair sharing one cell', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 6, 6);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in horizontally adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 9, 5);
    grid.insert(2, 11, 5);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in vertically adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 9);
    grid.insert(2, 5, 11);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds a pair in diagonally adjacent cells', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 9, 9);
    grid.insert(2, 11, 11);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('ignores a pair that is cells apart', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 85, 85);
    expect(grid.candidatePairs()).toEqual([]);
  });

  it('never emits the same unordered pair twice', () => {
    const grid = new SpatialGrid(100, 100, 10);
    for (let i = 0; i < 20; i++) grid.insert(i, 50 + (i % 3), 50 + (i % 2));
    const pairs = grid.candidatePairs();
    const keys = pairs.map(([a, b]) => a + ':' + b);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('always orders a pair with the lower id first', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(9, 5, 5);
    grid.insert(3, 6, 6);
    for (const [a, b] of grid.candidatePairs()) expect(a).toBeLessThan(b);
  });

  it('produces the same order for the same insertions', () => {
    const build = () => {
      const grid = new SpatialGrid(100, 100, 10);
      for (let i = 0; i < 50; i++) {
        grid.insert(i, (i * 7) % 100, (i * 13) % 100);
      }
      return grid.candidatePairs();
    };
    expect(build()).toEqual(build());
  });

  it('clear removes all occupants', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 5, 5);
    grid.insert(2, 6, 6);
    grid.clear();
    expect(grid.candidatePairs()).toEqual([]);
  });

  it('clamps positions on or beyond the boundary into the grid', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 100, 100);
    grid.insert(2, 99.9, 99.9);
    expect(grid.candidatePairs()).toEqual([[1, 2]]);
  });

  it('finds every pair among coincident points', () => {
    const grid = new SpatialGrid(100, 100, 10);
    grid.insert(1, 50, 50);
    grid.insert(2, 50, 50);
    grid.insert(3, 50, 50);
    expect(grid.candidatePairs()).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
  });
});
