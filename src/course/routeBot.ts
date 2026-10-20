import { Vector3 } from 'three';
import { DT } from '../config';
import { handPosition } from '../gadgets/grapple';
import type { GadgetId } from '../gadgets/types';
import { type AnyEvent, AttemptState, type RunSession, type SessionInput, SessionEvent, idleInput } from '../game/session';
import { raycast } from '../sim/collision';

// A scripted player for proving a course can be finished: it runs between waypoints, jumps at
// edges, and fires its gadget where the route says. Used by tests, never by the game.

export interface Waypoint {
  x: number;
  z: number;
  /** Brake toward this speed while heading here, m/s. */
  maxSpeed?: number;
  /** Don't auto-jump while heading here (e.g. on a pad or a rope). */
  noJump?: boolean;
  /** Jump as soon as this waypoint becomes the target. */
  jump?: boolean;
  /** Press jump on becoming the target even in the air (a wall jump off the wall being run). */
  kick?: boolean;
  /** On becoming the target: hook this point and hold until `releaseZ` is passed (or, climbing, `releaseY`). */
  grapple?: { at: [number, number, number]; releaseZ: number; releaseY?: number };
  /** On becoming the target: throw a pad at this point. */
  pad?: [number, number, number];
  /** From here on, press and hold this gadget's slot key (slot 1's until a route says otherwise). */
  select?: GadgetId;
  /** Press the gadget's key once on becoming the target (e.g. to dash). */
  press?: boolean;
  /** Hold the gadget's key (jetpack thrust) while heading here. */
  hold?: boolean;
  /** Hold slide/crouch while heading here. */
  crouch?: boolean;
  /** Press sprint (it toggles) on becoming the target. */
  sprint?: boolean;
  /** Keep jump held in the air while heading here, to mantle a ledge; on the ground, jump at a wall ahead. */
  holdJump?: boolean;
}

export interface BotRun {
  finished: boolean;
  seconds: number;
  falls: number;
  /** Where it was when the run ended or gave up, for debugging. */
  last: Vector3;
  /** The waypoint it was heading for. */
  waypoint: number;
  events: AnyEvent[];
}

const down = new Vector3(0, -1, 0);
const probe = new Vector3();
const ahead = new Vector3();
const hand = new Vector3();

/** Drives `session` along `route` until it finishes or `maxSeconds` pass. */
export function runRoute(session: RunSession, route: Waypoint[], maxSeconds = 120): BotRun {
  const p = session.player;
  let target = 0;
  let falls = 0;
  let holding: { releaseZ: number; releaseY: number; slot: number } | null = null;
  /** The slot whose key the route is using. */
  let slot = 0;
  const use = (input: SessionInput, i: number, pressed: boolean) => {
    input.use[i] = true;
    if (pressed) input.usePressed[i] = true;
  };
  let entered = -1;
  const events: AnyEvent[] = [];
  const before = new Vector3();
  let fellAt: Vector3 | null = null;

  for (let t = 0; t < maxSeconds && session.state !== AttemptState.Finished; t += DT) {
    const wp = route[Math.min(target, route.length - 1)];
    const input: SessionInput = idleInput();
    // On a rope, steer for where the swing is going, not the waypoint that fired it.
    const aim = holding ? route[Math.min(target + 1, route.length - 1)] : wp;
    const dx = aim.x - p.pos.x;
    const dz = aim.z - p.pos.z;
    input.yaw = Math.atan2(-dx, -dz);
    const speed = Math.hypot(p.vel.x, p.vel.z);
    // Over the speed limit: brake on the ground, stop steering forward in the air.
    input.forward = 1;
    if (wp.maxSpeed !== undefined && speed > wp.maxSpeed + 0.5) {
      if (!p.grounded) input.forward = 0;
      else {
        // Brake and steer at once: pull back against the travel, plus toward the target.
        const d = Math.hypot(dx, dz) || 1;
        const wx = dx / d - (1.5 * p.vel.x) / speed;
        const wz = dz / d - (1.5 * p.vel.z) / speed;
        input.yaw = Math.atan2(-wx, -wz);
      }
    }

    // Fresh target: fire whatever it asks for.
    if (entered !== target) {
      entered = target;
      if (wp.select) slot = Math.max(0, session.loadout.indexOf(wp.select));
      if (wp.jump && p.grounded) input.jump = true;
      if (wp.kick) input.jump = true;
      if (wp.sprint) input.sprint = true;
      if (wp.press) use(input, slot, true);
      if (wp.grapple || wp.pad) {
        const aimAt = new Vector3(...(wp.grapple ? wp.grapple.at : wp.pad!));
        handPosition(p, hand);
        input.aimOrigin = hand.clone();
        input.aimDir = aimAt.clone().sub(hand).normalize();
        use(input, slot, true);
        if (wp.grapple) holding = { releaseZ: wp.grapple.releaseZ, releaseY: wp.grapple.releaseY ?? Infinity, slot };
      }
    }
    if (holding) {
      if (p.pos.z > holding.releaseZ && p.pos.y < holding.releaseY) use(input, holding.slot, false);
      else {
        // Let go: on to the next waypoint.
        holding = null;
        target = Math.min(target + 1, route.length - 1);
      }
    }
    if (wp.hold) use(input, slot, false);
    if (wp.crouch) input.crouch = true;
    if (wp.holdJump && !p.grounded) input.jump = true;
    // Climbing: a ledge right ahead, on the ground. Pulse jump (it fires on the press), then hold.
    if (wp.holdJump && p.grounded && speed > 1) {
      probe.set(p.pos.x, p.pos.y + 0.5, p.pos.z);
      ahead.set(p.vel.x / speed, 0, p.vel.z / speed);
      if (raycast(session.boxes, probe, ahead, 1.6)) input.jump = !p.jumpHeld;
    }

    // Jump at the edge of whatever we're running on.
    if (!wp.noJump && !holding && p.grounded && speed > 1) {
      const ahead = 0.5 + speed * 0.07;
      probe.set(p.pos.x + (p.vel.x / speed) * ahead, p.pos.y + 1, p.pos.z + (p.vel.z / speed) * ahead);
      if (!raycast(session.boxes, probe, down, 3.5)) input.jump = true;
    }

    before.copy(p.pos);
    const ev = session.step(input);
    events.push(...ev);
    if (ev.includes(SessionEvent.Fell)) {
      falls++;
      fellAt ??= before.clone();
      holding = null;
      // Back to the nearest waypoint at or before where we respawned.
      target = nearestWaypoint(route, p.pos);
      entered = -1;
      if (falls > 6) break;
      continue;
    }
    // Stay on a grapple waypoint until the rope is let go.
    if (!holding && Math.hypot(dx, dz) < 2.5) target = Math.min(target + 1, route.length - 1);
  }
  return {
    finished: session.state === AttemptState.Finished,
    seconds: session.result?.seconds ?? session.elapsed,
    falls,
    last: fellAt ?? p.pos.clone(),
    waypoint: target,
    events,
  };
}

function nearestWaypoint(route: Waypoint[], pos: Vector3): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = Math.hypot(route[i].x - pos.x, route[i].z - pos.z);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
