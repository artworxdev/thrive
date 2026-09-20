import { describe, it, expect } from 'vitest';
import { fitViewport, worldToScreen } from '../src/viewport.js';

describe('fitViewport', () => {
  it('fills a canvas of matching aspect ratio exactly', () => {
    const v = fitViewport(1000, 600, 500, 300);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.offsetX).toBeCloseTo(0);
    expect(v.offsetY).toBeCloseTo(0);
  });

  it('letterboxes horizontally when the canvas is too wide', () => {
    const v = fitViewport(1000, 600, 2000, 600);
    expect(v.scale).toBeCloseTo(1);
    expect(v.offsetX).toBeCloseTo(500);
    expect(v.offsetY).toBeCloseTo(0);
  });

  it('letterboxes vertically when the canvas is too tall', () => {
    const v = fitViewport(1000, 600, 1000, 1200);
    expect(v.scale).toBeCloseTo(1);
    expect(v.offsetX).toBeCloseTo(0);
    expect(v.offsetY).toBeCloseTo(300);
  });

  it('never scales the world beyond the canvas', () => {
    const v = fitViewport(1000, 600, 200, 900);
    expect(1000 * v.scale).toBeLessThanOrEqual(200 + 1e-9);
    expect(600 * v.scale).toBeLessThanOrEqual(900 + 1e-9);
  });

  it('returns a zero scale for a canvas with no area', () => {
    expect(fitViewport(1000, 600, 0, 0).scale).toBe(0);
  });
});

describe('worldToScreen', () => {
  it('maps the world origin to the viewport offset', () => {
    const v = fitViewport(1000, 600, 2000, 600);
    expect(worldToScreen(v, 0, 0)).toEqual({ x: 500, y: 0 });
  });

  it('maps the far corner to the opposite edge of the fitted box', () => {
    const v = fitViewport(1000, 600, 500, 300);
    const corner = worldToScreen(v, 1000, 600);
    expect(corner.x).toBeCloseTo(500);
    expect(corner.y).toBeCloseTo(300);
  });

  it('maps the world centre to the canvas centre', () => {
    const v = fitViewport(1000, 600, 2000, 1200);
    const centre = worldToScreen(v, 500, 300);
    expect(centre.x).toBeCloseTo(1000);
    expect(centre.y).toBeCloseTo(600);
  });

  it('is independent of canvas size for relative positions', () => {
    const small = fitViewport(1000, 600, 500, 300);
    const large = fitViewport(1000, 600, 1000, 600);
    expect(worldToScreen(large, 250, 150).x).toBeCloseTo(
      worldToScreen(small, 250, 150).x * 2,
    );
  });
});
