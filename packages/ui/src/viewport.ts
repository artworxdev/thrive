export interface Viewport {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/**
 * Letterboxed fit: the world keeps its aspect ratio and is centred in the
 * canvas, so the simulation never depends on window size.
 */
export function fitViewport(
  worldWidth: number,
  worldHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): Viewport {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { scale: 0, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.min(canvasWidth / worldWidth, canvasHeight / worldHeight);
  return {
    scale,
    offsetX: (canvasWidth - worldWidth * scale) / 2,
    offsetY: (canvasHeight - worldHeight * scale) / 2,
  };
}

export function worldToScreen(
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: viewport.offsetX + x * viewport.scale,
    y: viewport.offsetY + y * viewport.scale,
  };
}
