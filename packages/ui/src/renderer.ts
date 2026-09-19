import type { Snapshot } from '@thrive/core';
import type { Viewport } from './viewport.js';
import { worldToScreen } from './viewport.js';

const MALE = '#4a90d9';
const FEMALE = '#e0709f';
const BOND = 'rgba(255, 255, 255, 0.35)';
const WORLD_FILL = '#11161d';
const WORLD_EDGE = '#39424f';
const OLDEST_AGE = 95;

/** Young to old, blue-green through amber, when the age overlay is on. */
function ageColor(age: number): string {
  const t = Math.min(1, Math.max(0, age / OLDEST_AGE));
  const hue = 170 - 150 * t;
  return 'hsl(' + hue.toFixed(0) + ', 70%, 60%)';
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  snapshot: Snapshot,
  viewport: Viewport,
  options: { colorByAge: boolean },
): void {
  const { canvas } = ctx;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const origin = worldToScreen(viewport, 0, 0);
  const width = snapshot.worldWidth * viewport.scale;
  const height = snapshot.worldHeight * viewport.scale;

  ctx.fillStyle = WORLD_FILL;
  ctx.fillRect(origin.x, origin.y, width, height);
  ctx.strokeStyle = WORLD_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(origin.x + 0.5, origin.y + 0.5, width - 1, height - 1);

  const radius = Math.max(1, snapshot.agentRadius * viewport.scale);
  const positions = new Map<number, { x: number; y: number }>();
  for (const agent of snapshot.agents) {
    positions.set(agent.id, worldToScreen(viewport, agent.x, agent.y));
  }

  // Bond lines first, so dots sit on top of them.
  ctx.strokeStyle = BOND;
  ctx.lineWidth = Math.max(1, radius * 0.4);
  ctx.beginPath();
  for (const agent of snapshot.agents) {
    if (agent.partnerId === null || agent.id > agent.partnerId) continue;
    const from = positions.get(agent.id);
    const to = positions.get(agent.partnerId);
    if (from === undefined || to === undefined) continue;
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
  }
  ctx.stroke();

  for (const agent of snapshot.agents) {
    const point = positions.get(agent.id);
    if (point === undefined) continue;
    ctx.fillStyle = options.colorByAge
      ? ageColor(agent.age)
      : agent.gender === 'male'
        ? MALE
        : FEMALE;
    ctx.beginPath();
    ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}
