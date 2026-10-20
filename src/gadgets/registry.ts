import { DASH_CONFIG, GRAPPLE_CONFIG, JETPACK_CONFIG, LAUNCH_PAD_CONFIG, USAGE_CONFIG, WINGSUIT_CONFIG } from '../config';
import { GrappleGadget } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { DashGadget } from './dash';
import { JetpackGadget } from './jetpack';
import { WingsuitGadget } from './wingsuit';
import { type GadgetDefinition, GadgetId } from './types';

export const GADGETS: readonly GadgetDefinition[] = [
  {
    id: GadgetId.Grapple,
    displayName: 'Grappling Hook',
    actionHint: 'Hold E to hook any surface under the crosshair · release to let go',
    slot: 1,
    budgetLabel: `x${USAGE_CONFIG.grappleSwings}`,
    summary: 'Fire a rope at any surface under the crosshair, swing beneath it as it reels you in, and let go to fly on with a boost.',
    stats: [
      ['Uses', `${USAGE_CONFIG.grappleSwings} swings (misses are free)`],
      ['Range', `${GRAPPLE_CONFIG.range} m`],
      ['Reel-in', `${GRAPPLE_CONFIG.reelSpeed} m/s`],
      ['Release boost', `+${GRAPPLE_CONFIG.releaseBoost} m/s`],
    ],
    create: () => new GrappleGadget(),
  },
  {
    id: GadgetId.Jetpack,
    displayName: 'Jetpack',
    actionHint: 'Hold E to thrust upward',
    slot: 2,
    budgetLabel: `${USAGE_CONFIG.jetpackSeconds}s`,
    summary: 'Hold to thrust straight up, from the ground or mid-air. Steer as normal while you climb.',
    stats: [
      ['Fuel', `${USAGE_CONFIG.jetpackSeconds} s (only burns while thrusting)`],
      ['Climb speed', `up to ${JETPACK_CONFIG.maxRiseSpeed} m/s`],
    ],
    create: () => new JetpackGadget(),
  },
  {
    id: GadgetId.LaunchPad,
    displayName: 'Launch Pad',
    actionHint: 'E to throw a pad · it launches you the way you faced',
    slot: 3,
    budgetLabel: `x${USAGE_CONFIG.padLaunches}`,
    summary: 'Throw a pad onto flat ground. Step on it to launch up and along the way you faced when you threw it.',
    stats: [
      ['Uses', `${USAGE_CONFIG.padLaunches} launch (re-throws are free)`],
      ['Throw range', `${LAUNCH_PAD_CONFIG.throwRange} m`],
      ['Launch', `${LAUNCH_PAD_CONFIG.launchHorizontal} m/s forward, ${LAUNCH_PAD_CONFIG.launchVertical} m/s up`],
    ],
    create: () => new LaunchPadGadget(),
  },
  {
    id: GadgetId.Dash,
    displayName: 'Dash Thruster',
    actionHint: 'E to dash the way you are going',
    slot: 4,
    budgetLabel: `x${USAGE_CONFIG.dashes}`,
    summary: 'A quick, level burst the way you are moving (or looking), on the ground or in the air.',
    stats: [
      ['Uses', `${USAGE_CONFIG.dashes} dashes`],
      ['Burst', `${DASH_CONFIG.speed} m/s, or +${DASH_CONFIG.boostOverCurrent} m/s if faster`],
      ['Cooldown', `${DASH_CONFIG.cooldown} s`],
    ],
    create: () => new DashGadget(),
  },
  {
    id: GadgetId.Wingsuit,
    displayName: 'Wingsuit',
    actionHint: 'Hold E in the air to glide · look down to dive, up to float',
    slot: 5,
    budgetLabel: `${USAGE_CONFIG.wingsuitSeconds}s`,
    summary: 'Hold in the air to glide where you look. Look down to dive and gain speed, up to float.',
    stats: [
      ['Glide time', `${USAGE_CONFIG.wingsuitSeconds} s`],
      ['Glide speed', `${WINGSUIT_CONFIG.speed} m/s level, faster diving`],
      ['Sink', `${WINGSUIT_CONFIG.sink} m/s level`],
    ],
    create: () => new WingsuitGadget(),
  },
];

export const DEFAULT_GADGET = GadgetId.Grapple;
export const DEFAULT_LOADOUT: readonly GadgetId[] = [GadgetId.Grapple, GadgetId.Jetpack, GadgetId.Dash];

export function gadgetDefinition(id: GadgetId): GadgetDefinition {
  return GADGETS.find((g) => g.id === id) ?? GADGETS[0];
}

export function isGadgetId(v: unknown): v is GadgetId {
  return GADGETS.some((g) => g.id === v);
}
