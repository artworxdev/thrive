import type { AgentId } from './types.js';
import type { SimConfig } from './config.js';
import type { Agent } from './agent.js';
import type { PhysicsBody } from './physics.js';

/**
 * Maps agents onto physics bodies. A solo agent is its own body. A bonded pair
 * becomes one body centred on the pair's midpoint, represented by the lower id
 * and carrying a radius that covers both members plus the bond offset.
 */
export function buildBodies(agents: Agent[], config: SimConfig): PhysicsBody[] {
  const byId = new Map<AgentId, Agent>();
  for (const agent of agents) byId.set(agent.id, agent);

  const pairRadius = config.union.bondOffset / 2 + config.agentRadius;
  const bodies: PhysicsBody[] = [];

  for (const agent of agents) {
    if (agent.partnerId === null) {
      bodies.push({
        agentId: agent.id,
        x: agent.x,
        y: agent.y,
        dx: agent.dx,
        dy: agent.dy,
        speed: agent.speed,
        radius: config.agentRadius,
      });
      continue;
    }

    const partner = byId.get(agent.partnerId);
    if (partner === undefined) continue; // partner already removed
    if (agent.id > partner.id) continue; // the lower id leads

    bodies.push({
      agentId: agent.id,
      x: (agent.x + partner.x) / 2,
      y: (agent.y + partner.y) / 2,
      dx: agent.dx,
      dy: agent.dy,
      speed: agent.speed,
      radius: pairRadius,
    });
  }

  return bodies;
}

/** Writes post-physics body state back onto the agents it represents. */
export function applyBodies(
  bodies: PhysicsBody[],
  byId: Map<AgentId, Agent>,
  config: SimConfig,
): void {
  const half = config.union.bondOffset / 2;
  const r = config.agentRadius;

  for (const body of bodies) {
    const leader = byId.get(body.agentId);
    if (leader === undefined) continue;

    leader.dx = body.dx;
    leader.dy = body.dy;

    if (leader.partnerId === null) {
      leader.x = body.x;
      leader.y = body.y;
      continue;
    }

    const follower = byId.get(leader.partnerId);
    if (follower === undefined) {
      leader.x = body.x;
      leader.y = body.y;
      continue;
    }

    // Offset perpendicular to travel, symmetric about the body centre.
    const px = -body.dy * half;
    const py = body.dx * half;
    leader.x = clamp(body.x - px, r, config.world.width - r);
    leader.y = clamp(body.y - py, r, config.world.height - r);
    follower.x = clamp(body.x + px, r, config.world.width - r);
    follower.y = clamp(body.y + py, r, config.world.height - r);
    follower.dx = body.dx;
    follower.dy = body.dy;
    follower.speed = leader.speed;
  }
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
