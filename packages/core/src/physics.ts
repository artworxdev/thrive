import type { AgentId } from './types.js';
import type { SpatialGrid } from './grid.js';

/**
 * A movable body. One solo agent is one body; a bonded pair is one body
 * represented by its leader with an enlarged radius. Physics never looks at
 * gender, age, or union state.
 */
export interface PhysicsBody {
  agentId: AgentId;
  x: number;
  y: number;
  /** Unit direction. */
  dx: number;
  dy: number;
  /** World units per year. */
  speed: number;
  radius: number;
}

export interface WorldBounds {
  width: number;
  height: number;
}

export function advance(body: PhysicsBody, dt: number): void {
  body.x += body.dx * body.speed * dt;
  body.y += body.dy * body.speed * dt;
}

export function bounceWalls(body: PhysicsBody, world: WorldBounds): void {
  const r = body.radius;
  if (body.x < r) {
    body.x = r;
    body.dx = Math.abs(body.dx);
  } else if (body.x > world.width - r) {
    body.x = world.width - r;
    body.dx = -Math.abs(body.dx);
  }
  if (body.y < r) {
    body.y = r;
    body.dy = Math.abs(body.dy);
  } else if (body.y > world.height - r) {
    body.y = world.height - r;
    body.dy = -Math.abs(body.dy);
  }
}

/**
 * Mirrors each direction about the line of centres and separates any overlap.
 * Each body keeps its own speed — no momentum exchange, per the design.
 * Returns true when the bodies were in contact.
 */
export function resolveCollision(a: PhysicsBody, b: PhysicsBody): boolean {
  const touchDistance = a.radius + b.radius;
  let nx = b.x - a.x;
  let ny = b.y - a.y;
  let distance = Math.hypot(nx, ny);

  if (distance > touchDistance) return false;

  if (distance === 0) {
    // Deterministic fallback so coincident bodies never produce NaN.
    nx = 1;
    ny = 0;
    distance = 1e-6;
  } else {
    nx /= distance;
    ny /= distance;
  }

  // Separate, half the overlap each.
  const overlap = touchDistance - distance;
  if (overlap > 0) {
    const shift = overlap / 2;
    a.x -= nx * shift;
    a.y -= ny * shift;
    b.x += nx * shift;
    b.y += ny * shift;
  }

  // Reflect only the body that is closing on the other, so contacts that are
  // already separating do not stick.
  const aClosing = a.dx * nx + a.dy * ny;
  if (aClosing > 0) {
    a.dx -= 2 * aClosing * nx;
    a.dy -= 2 * aClosing * ny;
  }
  const bClosing = b.dx * -nx + b.dy * -ny;
  if (bClosing > 0) {
    b.dx -= 2 * bClosing * -nx;
    b.dy -= 2 * bClosing * -ny;
  }

  return true;
}

/**
 * One sub-step: move, bounce off walls, then resolve contacts found through
 * the grid. Bodies must arrive in ascending agentId order; the returned
 * encounters follow the grid's stable scan order.
 */
export function stepBodies(
  bodies: PhysicsBody[],
  world: WorldBounds,
  grid: SpatialGrid,
  dt: number,
): Array<[AgentId, AgentId]> {
  const byId = new Map<AgentId, PhysicsBody>();

  grid.clear();
  for (const body of bodies) {
    advance(body, dt);
    bounceWalls(body, world);
    grid.insert(body.agentId, body.x, body.y);
    byId.set(body.agentId, body);
  }

  const encounters: Array<[AgentId, AgentId]> = [];
  for (const [idA, idB] of grid.candidatePairs()) {
    const a = byId.get(idA);
    const b = byId.get(idB);
    if (a === undefined || b === undefined) continue;
    if (resolveCollision(a, b)) encounters.push([idA, idB]);
  }
  return encounters;
}
