import { Vector3 } from 'three';
import { ABILITY_CONFIG, DT, MOVEMENT_CONFIG, PLAYER_SHAPE } from '../config';
import { type Box, type Contact, capsuleBoxContact, raycast } from './collision';

export type MovementConfig = typeof MOVEMENT_CONFIG;

/** One tick of player intent. Move axes are in [-1, 1], relative to `yaw`. */
export interface PlayerInput {
  forward: number;
  right: number;
  /** Camera heading, radians; 0 faces -Z. */
  yaw: number;
  jump: boolean;
  /** Slide / crouch held. */
  crouch: boolean;
  /** Sprint pressed this tick (it toggles). */
  sprint?: boolean;
}

export const NO_INPUT: PlayerInput = { forward: 0, right: 0, yaw: 0, jump: false, crouch: false };

export enum Stance {
  Stand = 'stand',
  Slide = 'slide',
  Crouch = 'crouch',
  /** Crouch held in the air: legs tucked up, head where it was. */
  Tuck = 'tuck',
}

/** A ledge pull-up in progress: the player moves along a fixed path, without collisions. */
export interface Mantle {
  from: Vector3;
  to: Vector3;
  /** Seconds into the pull-up. */
  t: number;
  /** Horizontal velocity to leave with. */
  exitVel: Vector3;
  normal: Vector3;
}

export interface PlayerState {
  /** Feet: the bottom of the capsule. */
  pos: Vector3;
  vel: Vector3;
  grounded: boolean;
  groundNormal: Vector3;
  /** Seconds since last grounded, for coyote time. */
  airTime: number;
  /** Sprint switched on. */
  sprinting: boolean;
  /** Sprint stamina, 0 … 1, and the seconds until it starts refilling. */
  stamina: number;
  staminaDelay: number;
  /** Seconds since jump was pressed, for jump buffering; Infinity when no press is pending. */
  jumpQueued: number;
  jumpHeld: boolean;
  /** Set for the one tick a jump fires or a landing happens, for animation and sound. */
  justJumped: boolean;
  justLanded: boolean;
  /** Downward speed at the moment of landing, for squash. */
  landingSpeed: number;
  /** On a grapple line: always airborne, so the rope (not footing) decides the motion. */
  tethered: boolean;
  /** Jetpack thrusting this tick: the wingsuit pauses for it. */
  jetting: boolean;
  /** Seconds during which ground contact doesn't count, so a launch isn't glued back down. */
  airborneLock: number;
  stance: Stance;
  /** Seconds into the current slide (0 when not sliding). */
  slideTime: number;
  mantle: Mantle | null;
  /** Running along a wall: its outward normal and how long so far. */
  wallRun: { normal: Vector3; time: number; speed: number } | null;
  /** The wall last run on or kicked off; it can't be used again until you land or touch another. */
  lastWall: Vector3 | null;
  /** Seconds left in which air steering is off, so a wall kick carries you away from the wall. */
  airSteerLock: number;
  /** Set for the one tick a slide starts or a mantle grabs, for animation and sound. */
  justSlid: boolean;
  /** Set for the one tick a long slide's jump gives its burst of speed. */
  justSlideJumped: boolean;
  /** Set for the one tick a slide reaches the length that earns the jump burst. */
  justSlideReady: boolean;
  justMantled: boolean;
  justWallRun: boolean;
  justWallJumped: boolean;
}

export function createPlayer(pos: Vector3): PlayerState {
  return {
    pos: pos.clone(),
    vel: new Vector3(),
    grounded: false,
    groundNormal: new Vector3(0, 1, 0),
    airTime: 0,
    sprinting: false,
    stamina: 1,
    staminaDelay: 0,
    jumpQueued: Infinity,
    jumpHeld: false,
    justJumped: false,
    justLanded: false,
    landingSpeed: 0,
    tethered: false,
    jetting: false,
    airborneLock: 0,
    stance: Stance.Stand,
    slideTime: 0,
    mantle: null,
    justSlid: false,
    justSlideJumped: false,
    justSlideReady: false,
    justMantled: false,
    wallRun: null,
    lastWall: null,
    airSteerLock: 0,
    justWallRun: false,
    justWallJumped: false,
  };
}

/** Puts a player at `pos`, standing still: used for spawns and respawns. */
export function resetPlayer(p: PlayerState, pos: Vector3): void {
  p.pos.copy(pos);
  p.vel.set(0, 0, 0);
  p.grounded = false;
  p.groundNormal.set(0, 1, 0);
  p.airTime = 0;
  p.sprinting = false;
  p.stamina = 1;
  p.staminaDelay = 0;
  p.jumpQueued = Infinity;
  p.justJumped = false;
  p.justLanded = false;
  p.landingSpeed = 0;
  p.tethered = false;
  p.jetting = false;
  p.airborneLock = 0;
  p.stance = Stance.Stand;
  p.slideTime = 0;
  p.mantle = null;
  p.justSlid = false;
  p.justSlideJumped = false;
  p.justSlideReady = false;
  p.justMantled = false;
  p.wallRun = null;
  p.lastWall = null;
  p.airSteerLock = 0;
  p.justWallRun = false;
  p.justWallJumped = false;
}

/** Capsule height for a stance: sliding and crouching are low, a tuck a little shorter than standing. */
export function stanceHeight(stance: Stance): number {
  if (stance === Stance.Stand) return PLAYER_SHAPE.height;
  if (stance === Stance.Tuck) return PLAYER_SHAPE.height - ABILITY_CONFIG.tuckLift;
  return ABILITY_CONFIG.lowHeight;
}

/** Throws the player into the air with a new velocity (launch pads), unglued from the ground. */
export function launchPlayer(p: PlayerState, vel: Vector3): void {
  p.vel.copy(vel);
  p.grounded = false;
  p.groundNormal.set(0, 1, 0);
  p.airTime = Infinity;
  p.airborneLock = LAUNCH_AIRBORNE_SECONDS;
}
/** Long enough to clear the surface you launched from. */
const LAUNCH_AIRBORNE_SECONDS = 0.12;

export function horizontalSpeed(p: PlayerState): number {
  return Math.hypot(p.vel.x, p.vel.z);
}

const UP = new Vector3(0, 1, 0);
const a = new Vector3();
const b = new Vector3();
const contact: Contact = { normal: new Vector3(), depth: 0, onFace: true, point: new Vector3() };
const bestGround = new Vector3();
const wish = new Vector3();
const tuckPos = new Vector3();

/** Largest distance the capsule moves per collision substep; well under the radius, so it can't tunnel. */
const MAX_SUBSTEP_MOVE = PLAYER_SHAPE.radius * 0.5;
const RESOLVE_ITERATIONS = 4;

/** Height of the capsule being moved this tick (it shrinks while sliding or crouching). */
let capsuleHeight = PLAYER_SHAPE.height;

function capsuleEnds(pos: Vector3): void {
  a.set(pos.x, pos.y + PLAYER_SHAPE.radius, pos.z);
  b.set(pos.x, pos.y + Math.max(PLAYER_SHAPE.radius, capsuleHeight - PLAYER_SHAPE.radius), pos.z);
}

function minGroundY(cfg: MovementConfig): number {
  return Math.cos((cfg.maxGroundAngle * Math.PI) / 180);
}

/**
 * Pushes the capsule out of every box it overlaps and clips velocity against the surfaces.
 * Returns the most upward-facing walkable normal touched, or null.
 */
function resolve(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig, clipVelocity: boolean): Vector3 | null {
  let ground: Vector3 | null = null;
  const minY = minGroundY(cfg);
  for (let iter = 0; iter < RESOLVE_ITERATIONS; iter++) {
    let any = false;
    for (const box of boxes) {
      capsuleEnds(p.pos);
      if (!capsuleBoxContact(a, b, PLAYER_SHAPE.radius, box, contact)) continue;
      if (contact.depth < 1e-6) continue;
      any = true;
      const n = contact.normal;
      const walkable = n.y >= minY;
      if (!walkable && p.grounded && clipVelocity && stepUp(p, cfg)) continue;
      if (walkable && contact.onFace && (p.grounded || !clipVelocity)) {
        // Standing on ground: push straight up so you don't creep down slopes. Edges push
        // along their rounded normal instead, or a ledge lip would pop you upward.
        p.pos.y += contact.depth / n.y;
      } else {
        p.pos.addScaledVector(n, contact.depth);
      }
      // Running onto a new slope keeps your horizontal speed: the next tick's ground control
      // re-aims velocity along the surface, so clipping here would just bleed momentum.
      if (clipVelocity && !(walkable && p.grounded)) {
        const into = p.vel.dot(n);
        if (into < 0) {
          p.vel.addScaledVector(n, -into);
          const speed = p.vel.length();
          if (!walkable && n.y > -0.3 && speed > 0) {
            // Wall: lose along-wall speed in proportion to how head-on the hit was, so
            // glancing contact (or leaning into a wall while running) costs almost nothing.
            const headOn = -into / Math.hypot(speed, into);
            const vy = p.vel.y;
            p.vel.multiplyScalar(1 - (1 - cfg.collisionSlideFactor) * headOn);
            p.vel.y = vy;
          }
        }
      }
      if (walkable) {
        // An edge holds you up, but its rounded normal isn't a surface to run along.
        const surface = contact.onFace ? n : UP;
        if (!ground || surface.y > ground.y) ground = bestGround.copy(surface);
      }
    }
    if (!any) break;
  }
  return ground;
}

/**
 * Running into a low ledge edge (a kerb, a seam between pieces): lift the bottom sphere just
 * enough to roll over it instead of treating it as a wall. Uses the contact in `contact`.
 */
function stepUp(p: PlayerState, cfg: MovementConfig): boolean {
  const q = contact.point;
  const r = PLAYER_SHAPE.radius;
  const rise = q.y - p.pos.y;
  if (rise <= 0 || rise > cfg.stepHeight) return false;
  const dh = Math.hypot(q.x - p.pos.x, q.z - p.pos.z);
  if (dh >= r) return false;
  const lift = q.y + Math.sqrt(r * r - dh * dh) - (p.pos.y + r);
  if (lift <= 0 || lift > cfg.stepHeight) return false;
  p.pos.y += lift + 1e-4;
  return true;
}

function moveTowards(vx: number, vz: number, tx: number, tz: number, maxDelta: number): [number, number] {
  const dx = tx - vx;
  const dz = tz - vz;
  const dist = Math.hypot(dx, dz);
  if (dist <= maxDelta || dist === 0) return [tx, tz];
  return [vx + (dx / dist) * maxDelta, vz + (dz / dist) * maxDelta];
}

/** World-space unit wish direction from input, or zero. Diagonals are normalized. */
function wishDirection(input: PlayerInput, out: Vector3): Vector3 {
  let f = Math.max(-1, Math.min(1, input.forward));
  let r = Math.max(-1, Math.min(1, input.right));
  const len = Math.hypot(f, r);
  if (len === 0) return out.set(0, 0, 0);
  if (len > 1) {
    f /= len;
    r /= len;
  }
  const sin = Math.sin(input.yaw);
  const cos = Math.cos(input.yaw);
  return out.set(-sin * f + cos * r, 0, -cos * f - sin * r);
}

function groundControl(p: PlayerState, cfg: MovementConfig): void {
  const vx = p.vel.x;
  const vz = p.vel.z;
  const speed = Math.hypot(vx, vz);
  const hasWish = wish.lengthSq() > 0;
  let nx: number;
  let nz: number;
  if (!hasWish) {
    [nx, nz] = moveTowards(vx, vz, 0, 0, cfg.groundDeceleration * DT);
  } else if (speed <= cfg.groundSpeed && cfg.groundAcceleration > 0) {
    [nx, nz] = moveTowards(vx, vz, wish.x * cfg.groundSpeed, wish.z * cfg.groundSpeed, cfg.groundAcceleration * DT);
  } else if (speed < 1e-6) {
    nx = 0;
    nz = 0;
  } else {
    // Over top speed (from a ramp, a gadget, or coasting): steer by turning grip, and bleed
    // the extra speed slowly. With no push (groundAcceleration 0) you coast toward a stop.
    const floor = cfg.groundAcceleration > 0 ? cfg.groundSpeed : 0;
    // Pulling against your direction of travel brakes.
    const against = -(wish.x * vx + wish.z * vz) / speed;
    const brake = against > 0.3 ? cfg.brakeDeceleration * against : 0;
    const keep = Math.max(Math.min(floor, speed - brake * DT), speed - (cfg.groundedFriction + brake) * DT);
    const steer = (cfg.steerAcceleration * cfg.turnGrip * DT) / speed;
    [nx, nz] = moveTowards(vx / speed, vz / speed, wish.x, wish.z, steer);
    const len = Math.hypot(nx, nz) || 1;
    nx = (nx / len) * keep;
    nz = (nz / len) * keep;
  }

  // Gravity along the slope, scaled down so ordinary running isn't dragged around.
  const n = p.groundNormal;
  const g = cfg.gravity * cfg.slopeInfluence * n.y;
  nx += g * n.x * DT;
  nz += g * n.z * DT;

  const h = Math.hypot(nx, nz);
  if (h > cfg.maximumSpeed) {
    nx *= cfg.maximumSpeed / h;
    nz *= cfg.maximumSpeed / h;
  }
  p.vel.x = nx;
  p.vel.z = nz;
  // Follow the ground plane: whatever vertical speed keeps velocity along the surface.
  p.vel.y = -(n.x * nx + n.z * nz) / n.y;
}

function airControl(p: PlayerState, cfg: MovementConfig): void {
  p.vel.y = Math.max(-cfg.maximumFallSpeed, p.vel.y - cfg.gravity * DT);
  if (wish.lengthSq() === 0 || p.airSteerLock > 0) return;
  const before = Math.hypot(p.vel.x, p.vel.z);
  const accel = cfg.airAcceleration * cfg.airControlFactor * DT;
  p.vel.x += wish.x * accel;
  p.vel.z += wish.z * accel;
  // Steering can turn you, and speed you up to running speed, but never past what you had.
  const cap = Math.max(before, cfg.groundSpeed);
  const after = Math.hypot(p.vel.x, p.vel.z);
  if (after > cap) {
    p.vel.x *= cap / after;
    p.vel.z *= cap / after;
  }
}

/** Pushes the player out of anything they overlap (after a gadget moves them directly). */
export function depenetrate(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig = MOVEMENT_CONFIG): void {
  capsuleHeight = stanceHeight(p.stance);
  resolve(p, boxes, cfg, true);
}

/** Moves along the velocity in substeps small enough not to tunnel through thin platforms. */
function integrate(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig): Vector3 | null {
  const dist = p.vel.length() * DT;
  const steps = Math.max(1, Math.ceil(dist / MAX_SUBSTEP_MOVE));
  const sub = DT / steps;
  let ground: Vector3 | null = null;
  for (let i = 0; i < steps; i++) {
    p.pos.addScaledVector(p.vel, sub);
    const g = resolve(p, boxes, cfg, true);
    if (g) ground = savedGround.copy(g);
  }
  return ground;
}
const savedGround = new Vector3();

/**
 * Pulls a running player down onto the surface under their feet, so ramps and crests don't
 * turn into hops. Only for gentle changes of angle: a sharp lip, or nothing below, launches you.
 */
function snapToGround(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig): Vector3 | null {
  const r = PLAYER_SHAPE.radius;
  rayOrigin.set(p.pos.x, p.pos.y + r, p.pos.z);
  const hit = raycast(boxes, rayOrigin, DOWN, r + cfg.groundSnapDistance + r);
  if (!hit) return null;
  const n = hit.normal;
  if (n.y < minGroundY(cfg)) return null;
  if (n.dot(p.groundNormal) < Math.cos((cfg.groundSnapMaxAngle * Math.PI) / 180)) return null;
  // Rest the bottom sphere on the hit plane, directly below where we are.
  const y = hit.point.y + r / n.y - r;
  if (y > p.pos.y + SNAP_MAX_RISE || y < p.pos.y - cfg.groundSnapDistance) return null;
  // Partway over a ledge the edge holds you up before the ground under your axis does:
  // settle at the lowest height between here and the target that doesn't overlap anything.
  probe.set(p.pos.x, y, p.pos.z);
  if (y < p.pos.y && overlapsAny(probe, boxes)) {
    let lo = y;
    let hi = p.pos.y;
    for (let i = 0; i < 10; i++) {
      probe.y = (lo + hi) / 2;
      if (overlapsAny(probe, boxes)) lo = probe.y;
      else hi = probe.y;
    }
    p.pos.y = hi;
  } else {
    p.pos.y = y;
  }
  return bestGround.copy(n);
}
const probe = new Vector3();
/** Penetration deeper than this counts as overlapping, for snap searches. */
const OVERLAP_EPS = 1e-3;

function overlapsAny(pos: Vector3, boxes: readonly Box[]): boolean {
  capsuleEnds(pos);
  for (const box of boxes) {
    if (capsuleBoxContact(a, b, PLAYER_SHAPE.radius, box, contact) && contact.depth > OVERLAP_EPS) return true;
  }
  return false;
}
const DOWN = new Vector3(0, -1, 0);
const rayOrigin = new Vector3();
/** Snapping may lift you this much, to settle out of a shallow overlap. */
const SNAP_MAX_RISE = 0.05;

/** Whether a capsule of `height` fits at `pos`. */
function fits(pos: Vector3, height: number, boxes: readonly Box[]): boolean {
  const saved = capsuleHeight;
  capsuleHeight = height;
  const ok = !overlapsAny(pos, boxes);
  capsuleHeight = saved;
  return ok;
}

/**
 * Slide, crouch and tuck. On the ground, holding crouch at running speed slides and below it
 * crouch-walks; in the air it tucks the legs up (the head stays put), so you clear a little more.
 * Letting go stands up when there's room.
 */
function updateStance(p: PlayerState, input: PlayerInput, boxes: readonly Box[]): void {
  const c = ABILITY_CONFIG;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  const wantLow = input.crouch && !p.tethered;
  let next: Stance;
  // Uphill, a slide carries on (slowing hard) right down to a stop; elsewhere it drops to a
  // crouch below slide speed.
  slideUphill = headingUphill(p, speed);
  const keepSliding = p.stance === Stance.Slide && slideUphill && speed > c.slideStopSpeed;
  if (p.grounded && wantLow) next = speed >= c.slideMinSpeed || keepSliding ? Stance.Slide : Stance.Crouch;
  else if (!p.grounded && wantLow) next = Stance.Tuck;
  else next = Stance.Stand;

  if (next === Stance.Tuck && p.stance !== Stance.Tuck) {
    if (p.stance === Stance.Stand) {
      // Legs up: the feet rise and the head stays where it was, so there's always room.
      p.pos.y += c.tuckLift;
    } else if (!fits(p.pos, stanceHeight(Stance.Tuck), boxes)) {
      // Low off a ledge with no room to straighten into a tuck: stay low.
      next = p.stance;
    }
  } else if (p.stance === Stance.Tuck && next === Stance.Stand) {
    // Legs back down: the feet drop to where they were if there's room; else stand from here
    // (about to land); else stay tucked.
    tuckPos.copy(p.pos).y -= c.tuckLift;
    if (!p.grounded && fits(tuckPos, PLAYER_SHAPE.height, boxes)) p.pos.copy(tuckPos);
    else if (!fits(p.pos, PLAYER_SHAPE.height, boxes)) next = p.grounded ? Stance.Crouch : Stance.Tuck;
  }
  // Standing up needs room overhead; otherwise stay low until there is.
  if (next === Stance.Stand && p.stance !== Stance.Stand && p.stance !== Stance.Tuck && !fits(p.pos, PLAYER_SHAPE.height, boxes)) {
    next = p.stance === Stance.Slide && speed < c.slideMinSpeed ? Stance.Crouch : p.stance;
  }
  if (next === Stance.Slide && p.stance !== Stance.Slide) p.justSlid = true;
  const before = p.slideTime;
  p.slideTime = next === Stance.Slide && p.stance === Stance.Slide ? p.slideTime + DT : 0;
  const ready = ABILITY_CONFIG.slideJumpMinSeconds;
  if (before < ready && p.slideTime >= ready) p.justSlideReady = true;
  p.stance = next;
}

/**
 * Sprint: a press toggles it (on only with enough stamina). It drains stamina while running on
 * the ground and switches off when stamina runs out, you stop moving, or you crouch or slide.
 * Off, stamina refills after a short wait.
 */
function updateSprint(p: PlayerState, input: PlayerInput): void {
  const c = ABILITY_CONFIG;
  if (input.sprint) p.sprinting = !p.sprinting && p.stamina >= c.sprintMinToStart;
  const moving = wish.lengthSq() > 0;
  const low = p.stance === Stance.Slide || p.stance === Stance.Crouch;
  if (p.sprinting && (low || (p.grounded && !moving) || p.stamina <= 0)) p.sprinting = false;
  if (p.sprinting) {
    if (p.grounded && moving) p.stamina = Math.max(0, p.stamina - DT / c.sprintStaminaSeconds);
    p.staminaDelay = c.sprintRegenDelay;
    if (p.stamina <= 0) p.sprinting = false;
  } else if (p.staminaDelay > 0) {
    p.staminaDelay = Math.max(0, p.staminaDelay - DT);
  } else {
    p.stamina = Math.min(1, p.stamina + DT / c.sprintRegenSeconds);
  }
}

const sprintCfg = { ...MOVEMENT_CONFIG };

/** Running numbers while sprinting: a higher top speed, on top of whatever the gadget set. */
function sprintConfig(cfg: MovementConfig): MovementConfig {
  Object.assign(sprintCfg, cfg);
  sprintCfg.groundSpeed = Math.max(cfg.groundSpeed, ABILITY_CONFIG.sprintSpeed);
  return sprintCfg;
}

/** On the ground and travelling up a slope (steeper than slideMaxRise along the travel). */
function headingUphill(p: PlayerState, speed: number): boolean {
  if (!p.grounded || speed < 1e-3) return false;
  const n = p.groundNormal;
  // The normal leans downhill, so travelling against its lean is climbing: rise per metre of travel.
  const rise = -(p.vel.x * n.x + p.vel.z * n.z) / speed / Math.max(n.y, 1e-3);
  return rise > ABILITY_CONFIG.slideMaxRise;
}

/** Movement numbers for the current stance, on top of whatever the gadget set. */
function stanceConfig(p: PlayerState, cfg: MovementConfig): MovementConfig {
  if (p.stance === Stance.Stand || p.stance === Stance.Tuck) return cfg;
  const c = ABILITY_CONFIG;
  Object.assign(lowCfg, cfg);
  if (p.stance === Stance.Crouch) {
    lowCfg.groundSpeed = Math.min(cfg.groundSpeed, c.crouchSpeed);
    return lowCfg;
  }
  // Sliding: no pushing, little drag, slopes pull hard, limited steering. Whichever of the
  // gadget's numbers or the slide's is slicker wins.
  lowCfg.groundAcceleration = 0;
  lowCfg.groundedFriction = Math.min(cfg.groundedFriction, c.slideFriction);
  lowCfg.groundDeceleration = Math.min(cfg.groundDeceleration, c.slideFriction);
  lowCfg.slopeInfluence = Math.max(cfg.slopeInfluence, slideUphill ? c.slideUphillInfluence : c.slideSlopeInfluence);
  lowCfg.turnGrip = Math.min(cfg.turnGrip, c.slideTurnGrip);
  return lowCfg;
}
const lowCfg = {} as MovementConfig;
/** This tick's slide is going uphill (set by updateStance, read by stanceConfig). */
let slideUphill = false;

const mantleDir = new Vector3();
/** Heights above the feet probed for a wall to grab, m. */
const MANTLE_PROBE_HEIGHTS = [0.45, 1.0, 1.6];
const chest = new Vector3();
const above = new Vector3();
const mantleTo = new Vector3();

/**
 * Airborne with jump held and heading at a wall whose top is within reach: grab the ledge.
 * Returns true if a mantle started.
 */
function tryMantle(p: PlayerState, input: PlayerInput, boxes: readonly Box[], cfg: MovementConfig): boolean {
  const c = ABILITY_CONFIG;
  if (p.grounded || !input.jump || p.mantle || p.stance !== Stance.Stand) return false;
  // Heading: where the player is steering, else where they're going.
  if (wish.lengthSq() > 0) mantleDir.copy(wish);
  else {
    const speed = Math.hypot(p.vel.x, p.vel.z);
    if (speed < 1) return false;
    mantleDir.set(p.vel.x / speed, 0, p.vel.z / speed);
  }
  // A wall right in front of the body, at knee, chest or head height…
  let wall = null;
  for (const h of MANTLE_PROBE_HEIGHTS) {
    chest.set(p.pos.x, p.pos.y + h, p.pos.z);
    const hit = raycast(boxes, chest, mantleDir, PLAYER_SHAPE.radius + c.mantleReach);
    if (hit && Math.abs(hit.normal.y) <= 0.3) {
      wall = hit;
      break;
    }
  }
  if (!wall) return false;
  // …whose top, just past its face, is walkable and within reach.
  above.copy(wall.point).addScaledVector(mantleDir, c.mantleInset);
  above.y = p.pos.y + c.mantleMaxHeight + 0.05;
  const top = raycast(boxes, above, DOWN, c.mantleMaxHeight - c.mantleMinHeight + 0.05);
  if (!top || top.normal.y < minGroundY(cfg)) return false;
  const rise = top.point.y - p.pos.y;
  if (rise < c.mantleMinHeight || rise > c.mantleMaxHeight) return false;
  mantleTo.set(top.point.x, top.point.y + 0.01, top.point.z);
  if (!fits(mantleTo, PLAYER_SHAPE.height, boxes)) return false;

  const along = Math.max(0, p.vel.x * mantleDir.x + p.vel.z * mantleDir.z);
  p.mantle = {
    from: p.pos.clone(),
    to: mantleTo.clone(),
    t: 0,
    exitVel: mantleDir.clone().multiplyScalar(Math.max(cfg.groundSpeed, along * c.mantleKeepSpeed)),
    normal: top.normal.clone(),
  };
  p.vel.set(0, 0, 0);
  p.tethered = false;
  p.justMantled = true;
  return true;
}

/** Moves along the pull-up path: up first, then over the lip. */
function advanceMantle(p: PlayerState): void {
  const m = p.mantle!;
  m.t += DT;
  const k = Math.min(1, m.t / ABILITY_CONFIG.mantleDuration);
  const up = Math.min(1, k / 0.6);
  const over = Math.max(0, (k - 0.35) / 0.65);
  const ease = (x: number) => x * x * (3 - 2 * x);
  p.pos.set(
    m.from.x + (m.to.x - m.from.x) * ease(over),
    m.from.y + (m.to.y - m.from.y) * ease(up),
    m.from.z + (m.to.z - m.from.z) * ease(over),
  );
  p.vel.set(0, 0, 0);
  if (k < 1) return;
  p.pos.copy(m.to);
  p.vel.copy(m.exitVel);
  p.grounded = true;
  p.groundNormal.copy(m.normal);
  p.airTime = 0;
  p.mantle = null;
}

const wallProbe = new Vector3();
const wallDir = new Vector3();
const heading = new Vector3();

/** A near-vertical wall within reach in `dir` (horizontal, unit), from chest or hip height. */
function wallAt(p: PlayerState, boxes: readonly Box[], dir: Vector3, reach: number): Vector3 | null {
  for (const h of WALL_PROBE_HEIGHTS) {
    wallProbe.set(p.pos.x, p.pos.y + h, p.pos.z);
    const hit = raycast(boxes, wallProbe, dir, PLAYER_SHAPE.radius + reach);
    if (hit && Math.abs(hit.normal.y) < 0.3) return wallNormal.copy(hit.normal).setY(0).normalize();
  }
  return null;
}
const WALL_PROBE_HEIGHTS = [1.0, 0.5];
const wallNormal = new Vector3();

/** True if `n` is (about) the wall in `last`. */
const sameWall = (last: Vector3 | null, n: Vector3) => !!last && last.dot(n) > 0.9;

/**
 * A wall in reach at either side of the direction of travel. (Not straight ahead: jumping at a
 * wall in front is for mantling over it, not bouncing off.)
 */
function nearbyWall(p: PlayerState, boxes: readonly Box[]): Vector3 | null {
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (speed > 0.5) heading.set(p.vel.x / speed, 0, p.vel.z / speed);
  else if (wish.lengthSq() > 0) heading.copy(wish);
  else return null;
  const reach = ABILITY_CONFIG.wallReach;
  return wallAt(p, boxes, wallDir.set(-heading.z, 0, heading.x), reach) ?? wallAt(p, boxes, wallDir.set(heading.z, 0, -heading.x), reach);
}

/**
 * Jump pressed in the air beside a wall (or mid wall run): kick off it, away and up, keeping
 * your speed along it. Not off the same wall twice in a row.
 */
function tryWallJump(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig): boolean {
  if (p.grounded || p.tethered || p.stance !== Stance.Stand || p.jumpQueued > cfg.jumpBuffer) return false;
  const c = ABILITY_CONFIG;
  const n = p.wallRun ? p.wallRun.normal.clone() : nearbyWall(p, boxes)?.clone();
  if (!n || (!p.wallRun && sameWall(p.lastWall, n))) return false;
  const into = p.vel.x * n.x + p.vel.z * n.z;
  // Keep the along-the-wall part of your speed; replace the rest with the kick.
  p.vel.x = (p.vel.x - n.x * into) * c.wallJumpKeepAlong + n.x * c.wallJumpOut;
  p.vel.z = (p.vel.z - n.z * into) * c.wallJumpKeepAlong + n.z * c.wallJumpOut;
  p.vel.y = c.wallJumpUp;
  p.lastWall = n;
  p.wallRun = null;
  p.airSteerLock = c.wallJumpSteerLock;
  p.jumpQueued = Infinity;
  p.airTime = cfg.coyoteTime + 1;
  p.justWallJumped = true;
  p.justJumped = true;
  return true;
}

/** Airborne, fast, travelling along a wall at your side, with clear air below: start a wall run. */
function tryStartWallRun(p: PlayerState, boxes: readonly Box[]): void {
  const c = ABILITY_CONFIG;
  if (p.grounded || p.tethered || p.wallRun || p.stance !== Stance.Stand) return;
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (speed < c.wallRunMinSpeed) return;
  heading.set(p.vel.x / speed, 0, p.vel.z / speed);
  const reach = c.wallReach;
  const n = wallAt(p, boxes, wallDir.set(-heading.z, 0, heading.x), reach) ?? wallAt(p, boxes, wallDir.set(heading.z, 0, -heading.x), reach);
  if (!n || sameWall(p.lastWall, n)) return;
  // Travelling along it, not into it.
  const along = Math.sqrt(Math.max(0, 1 - (heading.x * n.x + heading.z * n.z) ** 2));
  if (along < c.wallRunMinAlong) return;
  // Not just skimming the floor.
  wallProbe.set(p.pos.x, p.pos.y + 0.1, p.pos.z);
  if (raycast(boxes, wallProbe, DOWN, c.wallRunMinHeight)) return;
  p.wallRun = { normal: n.clone(), time: 0, speed };
  p.lastWall = n.clone();
  p.vel.y = Math.max(p.vel.y * 0.3, c.wallRunStartUp);
  p.justWallRun = true;
}

/** While wall running: light gravity, held against the wall, speed kept. Ends when the wall or time runs out. */
function wallRunControl(p: PlayerState, boxes: readonly Box[], cfg: MovementConfig): void {
  const c = ABILITY_CONFIG;
  const run = p.wallRun!;
  run.time += DT;
  const n = run.normal;
  wallDir.copy(n).negate();
  const still = wallAt(p, boxes, wallDir, c.wallReach + 0.2);
  const speed = Math.hypot(p.vel.x, p.vel.z);
  if (!still || still.dot(n) < 0.8 || run.time > c.wallRunMaxSeconds || speed < c.wallRunEndSpeed) {
    p.wallRun = null;
    airControl(p, cfg);
    return;
  }
  // Run along the wall at the speed you came in with, leaning in lightly so contact holds.
  const into = p.vel.x * n.x + p.vel.z * n.z;
  let ax = p.vel.x - n.x * into;
  let az = p.vel.z - n.z * into;
  const along = Math.hypot(ax, az);
  if (along > 1e-3) {
    const keep = Math.max(along, run.speed) / along;
    ax *= keep;
    az *= keep;
  }
  p.vel.x = ax - n.x * c.wallRunStick;
  p.vel.z = az - n.z * c.wallRunStick;
  if (Math.hypot(ax, az) >= c.wallRunHoldSpeed) {
    // Fast enough: no height lost at all. The little rise from starting the run eases off to level.
    p.vel.y = Math.max(0, p.vel.y - cfg.gravity * c.wallRunGravityScale * DT);
  } else {
    p.vel.y = Math.max(-c.wallRunMaxSink, p.vel.y - cfg.gravity * c.wallRunGravityScale * DT);
  }
}

/** Advances a player by one tick. */
export function stepPlayer(p: PlayerState, input: PlayerInput, boxes: readonly Box[], baseCfg: MovementConfig = MOVEMENT_CONFIG): void {
  let cfg = baseCfg;
  p.justJumped = false;
  p.justLanded = false;
  p.justSlid = false;
  p.justSlideJumped = false;
  p.justSlideReady = false;
  p.justMantled = false;
  p.justWallRun = false;
  p.justWallJumped = false;
  p.airSteerLock = Math.max(0, p.airSteerLock - DT);
  if (input.jump && !p.jumpHeld) p.jumpQueued = 0;
  if (p.mantle) {
    p.jumpHeld = input.jump;
    advanceMantle(p);
    return;
  }
  const noFooting = p.tethered || p.airborneLock > 0;
  p.airborneLock = Math.max(0, p.airborneLock - DT);
  if (noFooting) p.grounded = false;

  if (!(input.jump && !p.jumpHeld)) p.jumpQueued += DT;
  p.jumpHeld = input.jump;

  wishDirection(input, wish);
  updateStance(p, input, boxes);
  updateSprint(p, input);
  cfg = stanceConfig(p, cfg);
  if (p.sprinting) cfg = sprintConfig(cfg);
  capsuleHeight = stanceHeight(p.stance);

  const canJump = p.grounded || p.airTime <= cfg.coyoteTime;
  // Jumping out of a slide or crouch stands you up first, if there's room.
  const roomToJump = p.stance === Stance.Stand || fits(p.pos, PLAYER_SHAPE.height, boxes);
  if (p.jumpQueued <= cfg.jumpBuffer && canJump && roomToJump) {
    // Jumping out of a slide held long enough gives a small burst of speed.
    if (p.stance === Stance.Slide && p.slideTime >= ABILITY_CONFIG.slideJumpMinSeconds) {
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > 1e-3) {
        const boosted = speed + ABILITY_CONFIG.slideJumpBoost;
        p.vel.x *= boosted / speed;
        p.vel.z *= boosted / speed;
        p.justSlideJumped = true;
      }
    }
    if (p.stance !== Stance.Stand) {
      p.stance = Stance.Stand;
      p.slideTime = 0;
      capsuleHeight = PLAYER_SHAPE.height;
      cfg = baseCfg;
    }
    p.vel.y = Math.max(p.vel.y, 0) + cfg.jumpImpulse;
    p.grounded = false;
    p.airTime = cfg.coyoteTime + 1;
    p.jumpQueued = Infinity;
    p.justJumped = true;
  }

  if (p.tethered || p.stance !== Stance.Stand) p.wallRun = null;
  tryWallJump(p, boxes, cfg);
  if (p.grounded) groundControl(p, cfg);
  else if (p.wallRun) wallRunControl(p, boxes, cfg);
  else {
    airControl(p, cfg);
    tryStartWallRun(p, boxes);
  }
  if (tryMantle(p, input, boxes, cfg)) return;

  const wasGrounded = p.grounded;
  const fallSpeed = -p.vel.y;
  // Speed away from the surface we were on: a ramp lip or a gadget launch, not a dip.
  const leaving = p.vel.dot(p.groundNormal);
  let ground = integrate(p, boxes, cfg);
  if (!ground && wasGrounded && !p.justJumped && leaving <= cfg.snapMaxUpSpeed) {
    ground = snapToGround(p, boxes, cfg);
  }
  if (noFooting) ground = null;

  if (ground) {
    if (!wasGrounded) {
      p.justLanded = true;
      p.landingSpeed = Math.max(0, fallSpeed);
      const speed = Math.hypot(p.vel.x, p.vel.z);
      if (speed > cfg.groundSpeed) {
        const keep = cfg.groundSpeed + (speed - cfg.groundSpeed) * cfg.momentumRetentionFactor;
        p.vel.x *= keep / speed;
        p.vel.z *= keep / speed;
      }
    }
    p.grounded = true;
    p.groundNormal.copy(ground);
    p.airTime = 0;
    // Landing ends a wall run and frees every wall again.
    p.wallRun = null;
    p.lastWall = null;
  } else {
    p.grounded = false;
    p.groundNormal.copy(UP);
    p.airTime += DT;
  }
}
