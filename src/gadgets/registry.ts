import { USAGE_CONFIG } from '../config';
import { GrappleGadget } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { DashGadget } from './dash';
import { JetpackGadget } from './jetpack';
import { type GadgetDefinition, GadgetId } from './types';

export const GADGETS: readonly GadgetDefinition[] = [
  {
    id: GadgetId.Grapple,
    displayName: 'Grappling Hook',
    actionHint: 'Hold E to hook any surface under the crosshair · release to let go',
    slot: 1,
    budgetLabel: `x${USAGE_CONFIG.grappleSwings}`,
    create: () => new GrappleGadget(),
  },
  {
    id: GadgetId.Jetpack,
    displayName: 'Jetpack',
    actionHint: 'Hold E to thrust upward',
    slot: 2,
    budgetLabel: `${USAGE_CONFIG.jetpackSeconds}s`,
    create: () => new JetpackGadget(),
  },
  {
    id: GadgetId.LaunchPad,
    displayName: 'Launch Pad',
    actionHint: 'E to throw a pad · it launches you the way you faced',
    slot: 3,
    budgetLabel: `x${USAGE_CONFIG.padLaunches}`,
    create: () => new LaunchPadGadget(),
  },
  {
    id: GadgetId.Dash,
    displayName: 'Dash Thruster',
    actionHint: 'E to dash the way you are going',
    slot: 4,
    budgetLabel: `x${USAGE_CONFIG.dashes}`,
    create: () => new DashGadget(),
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
