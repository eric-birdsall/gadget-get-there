// Every gameplay number lives here so the feel can be tuned in one place.
// The tuning panel (Esc → Tuning) edits these objects live.

export const TICK_RATE = 120;
export const DT = 1 / TICK_RATE;

/** Frames longer than this (tab stalls, breakpoints) are clipped so the sim never spirals. */
export const MAX_FRAME_SECONDS = 0.1;

export const PLAYER_SHAPE = {
  radius: 0.4,
  height: 1.8,
};

export const MOVEMENT_CONFIG = {
  /** Top running speed on flat ground, m/s. */
  groundSpeed: 10,
  /** How fast running reaches groundSpeed, m/s². */
  groundAcceleration: 80,
  /** How fast you stop with no input, m/s². */
  groundDeceleration: 55,
  /** Air steering strength, m/s². Steering can't raise speed past max(groundSpeed, current). */
  airAcceleration: 22,
  /** Multiplies airAcceleration; a quick knob for "how floaty does steering feel". */
  airControlFactor: 1,
  /** Upward speed a jump sets, m/s. With gravity 26 that's a ~1.7 m jump. */
  jumpImpulse: 9.5,
  gravity: 26,
  maximumFallSpeed: 50,
  /** How hard you can turn when above groundSpeed, m/s²; scaled by turnGrip. */
  steerAcceleration: 80,
  /** Slow-down when pulling against your travel above groundSpeed, m/s². */
  brakeDeceleration: 30,
  /** Turning grip multiplier (sliding lowers it). */
  turnGrip: 1,
  /** Hard cap on horizontal speed on the ground, m/s. */
  maximumSpeed: 45,
  /** Speed above groundSpeed bleeds off at this rate on the ground, m/s². Low keeps momentum. */
  groundedFriction: 7,
  /** Fraction of gravity that pulls you along a slope while grounded (0 = slopes don't push). */
  slopeInfluence: 0.12,
  /** Fraction of above-groundSpeed horizontal speed kept when landing. */
  momentumRetentionFactor: 0.96,
  /** Fraction of along-the-wall speed kept when you hit a wall at an angle. */
  collisionSlideFactor: 0.95,
  /** Steepest surface you can stand and run on, degrees. Steeper surfaces slide you off. */
  maxGroundAngle: 50,
  /** Grace period to still jump after running off a ledge, s. */
  coyoteTime: 0.1,
  /** A jump pressed this long before landing still fires on landing, s. */
  jumpBuffer: 0.12,
  /** Ledges up to this high are run over rather than blocking you, m. */
  stepHeight: 0.35,
  /** Keeps your feet on ramps and small dips while running, m. */
  groundSnapDistance: 0.35,
  /** Snapping only follows a change in ground angle up to this much; sharper lips launch you, degrees. */
  groundSnapMaxAngle: 25,
  /** Moving away from the ground faster than this skips snapping, so launches aren't glued down, m/s. */
  snapMaxUpSpeed: 1,
};

/** Character abilities: slide, crouch-walk and mantle. Separate from gadgets. */
export const ABILITY_CONFIG = {
  /** Capsule height while sliding or crouching, m. */
  lowHeight: 0.9,
  /** Slower than this, crouch held is a crouch-walk instead of a slide, m/s. */
  slideMinSpeed: 6,
  /** Speed added when a slide starts, m/s. */
  slideBoost: 3,
  /** The burst can't come again sooner than this, s. */
  slideBoostCooldown: 1,
  /** Drag while sliding, m/s². */
  slideFriction: 2.5,
  slideSlopeInfluence: 0.9,
  slideTurnGrip: 0.35,
  crouchSpeed: 4,
  /** Jumping out of a slide at least this long… s */
  slideJumpMinSeconds: 1.0,
  /** …adds this much speed, m/s. */
  slideJumpBoost: 2.5,
  /** Ledge tops this far above the feet can be mantled, m. */
  mantleMinHeight: 0.5,
  mantleMaxHeight: 2.8,
  /** How far ahead of the body a wall can be grabbed, m. */
  mantleReach: 0.5,
  /** How far past the wall face the player ends up, m. */
  mantleInset: 0.45,
  /** Wall run: start at this horizontal speed or more, m/s… */
  wallRunMinSpeed: 7,
  /** …travelling at least this much along the wall (1 = parallel), and this high above any floor, m. */
  wallRunMinAlong: 0.6,
  wallRunMinHeight: 0.8,
  /** How far from the body a wall can be run on or kicked off, m. */
  wallReach: 0.6,
  /** Longest wall run, s. */
  wallRunMaxSeconds: 1.4,
  /** Share of gravity while wall running, when slower than wallRunHoldSpeed. */
  wallRunGravityScale: 0.15,
  /** At or above this speed along the wall, a wall run holds its height exactly, m/s. */
  wallRunHoldSpeed: 9,
  /** Upward speed given when a wall run starts, m/s; and the fastest you sink while running, m/s. */
  wallRunStartUp: 1.5,
  wallRunMaxSink: 2.5,
  /** Slower than this along the wall, the run ends, m/s. */
  wallRunEndSpeed: 5,
  /** Small push into the wall that keeps contact, m/s. */
  wallRunStick: 0.4,
  /** Wall jump: speed away from the wall and upward, m/s; share of along-the-wall speed kept. */
  wallJumpOut: 8,
  wallJumpUp: 9.5,
  wallJumpKeepAlong: 1,
  /** Air steering is off this long after a wall jump, so the kick carries you clear, s. */
  wallJumpSteerLock: 0.3,
  /** Pull-up time, s. */
  mantleDuration: 0.25,
  /** Fraction of horizontal speed kept after a mantle (never below running speed). */
  mantleKeepSpeed: 0.6,
};

export const CAMERA_CONFIG = {
  distance: 6,
  /** Extra distance added at full speed, so fast running reads as fast. */
  highSpeedExtraDistance: 1.5,
  /** Height of the orbit pivot above the player's feet, m. */
  height: 1.7,
  /** Radians per pixel of mouse movement at sensitivity 1. */
  horizontalSensitivity: 0.0022,
  verticalSensitivity: 0.0022,
  /** Pitch limits, radians. Positive looks down. */
  minPitch: -0.9,
  maxPitch: 1.25,
  /** Starting pitch on spawn: slightly looking down at the player. */
  defaultPitch: 0.22,
  fieldOfView: 75,
  highSpeedFieldOfView: 92,
  /** FOV starts widening at the low end and reaches highSpeedFieldOfView at the high end, m/s. */
  speedForFovTransition: [11, 30] as [number, number],
  /** Exponential follow rate; higher is snappier, 1/s. */
  smoothing: 18,
  /** Vertical follow is softer so jumps don't bob the camera. */
  verticalSmoothing: 9,
  /** Without mouse capture: how close to the left/right edge (fraction of width) starts turning. */
  freeCursorEdgeZone: 0.12,
  /** Without mouse capture: turn rate with the cursor at or past the edge, radians/s. */
  freeCursorTurnSpeed: 3.2,
  /** Gap kept between the camera and any geometry it would clip into, m. */
  collisionAvoidanceDistance: 0.3,
};

/** Looking around with keys (I J K L by default) instead of, or as well as, the mouse. */
export const KEY_LOOK_CONFIG = {
  /** Full turn rate left/right once held, radians/s (about 180°/s). */
  turnSpeed: 3.2,
  /** Full tilt rate up/down, radians/s. */
  tiltSpeed: 1.8,
  /** Seconds of holding to reach the full rate. */
  rampSeconds: 0.35,
  /** A fresh press starts at this share of the full rate, for fine aim. */
  startFraction: 0.25,
  /** After letting go of up/down, wait this long before easing back to level, s. */
  levelDelay: 0.6,
  /** How quickly it eases back to level, 1/s. */
  levelRate: 2.5,
};

export const WORLD_CONFIG = {
  /** Falling this far below the course's lowest platform always counts as a fall. */
  killDepth: 25,
  /** Falling this far below where you last stood, with only void beneath, counts as a fall sooner. */
  voidFallDepth: 8,
};

export const GRAPPLE_CONFIG = {
  /** Farthest surface the hook can reach, measured from the player, m. */
  range: 42,
  /** Rope shortens at this rate while held, m/s. */
  reelSpeed: 9,
  minLength: 3,
  /** Constant pull toward where the rope is fixed, m/s². */
  pullAcceleration: 13,
  /** Upward kick when latching from the ground, so you leave it, m/s. */
  attachHop: 4,
  /** Speed added along your direction of travel on release, m/s. */
  releaseBoost: 2.5,
  /** Release boost never takes you past this speed, m/s. */
  releaseSpeedCap: 30,
  /** Height of the rope's attachment on the body, above the feet, m. */
  handHeight: 1.1,
};

export const JETPACK_CONFIG = {
  /** Upward acceleration while thrusting, before gravity, m/s². */
  thrust: 40,
  /** Fastest climb, m/s. */
  maxRiseSpeed: 8,
  /** Upward speed when lifting off the ground, m/s. */
  liftoffSpeed: 4,
};

export const WINGSUIT_CONFIG = {
  /** Gentle sink while gliding level, m/s… */
  sink: 2.2,
  /** …plus this much per unit of dive (looking down), m/s. */
  diveSink: 13,
  /** How hard the wings arrest a fall, m/s². */
  lift: 30,
  /** Glide speed level, m/s; extra per unit of dive; never slower than minSpeed. */
  speed: 15,
  diveSpeed: 14,
  minSpeed: 8,
  /** How fast speed changes toward the glide speed, m/s². */
  acceleration: 9,
  /** Turn rate toward where you look, radians/s. */
  turnRate: 1.8,
  /** Limits on looking down (dive) and up (flare). */
  maxDive: 0.8,
  maxFlare: 0.35,
};

export const DASH_CONFIG = {
  /** Horizontal speed a dash sets, m/s… */
  speed: 22,
  /** …or this much on top of your current speed, if that's faster. */
  boostOverCurrent: 8,
  /** A dash never starts falling faster than this upward speed, m/s (so it stays level). */
  minLift: 1,
  /** Shortest time between dashes, s. */
  cooldown: 0.35,
};

export const LAUNCH_PAD_CONFIG = {
  /** Farthest you can throw a pad, measured from the player, m. */
  throwRange: 32,
  /** Pads only stick to surfaces at least this flat (normal.y). */
  minSurfaceUpY: 0.75,
  /** Stepping within this radius of a pad (and this high above it) launches you, m. */
  triggerRadius: 1.4,
  triggerHeight: 0.9,
  /** Launch speed along the pad's heading and upward, m/s. */
  launchHorizontal: 17,
  launchVertical: 15,
  /** Fraction of your speed along the heading added on top, so running in launches farther. */
  keepAlongSpeed: 0.5,
  /** A pad can't fire again this soon after launching you, s. */
  rearmSeconds: 0.5,
  throwCooldown: 0.25,
};

/** Each gadget's budget per run. Fixed: the same on every level. */
export const USAGE_CONFIG = {
  grappleSwings: 2,
  padLaunches: 1,
  /** Seconds of jetpack thrust. */
  jetpackSeconds: 3,
  dashes: 3,
  /** Seconds of wingsuit glide. */
  wingsuitSeconds: 6,
};

export const GHOST_CONFIG = {
  /** Samples per second of run time. */
  sampleRate: 20,
  /** Recording stops after this long, s. */
  maxSeconds: 300,
  /** Consecutive samples farther apart than this are a respawn: snap, don't glide, m. */
  teleportDistance: 6,
};
