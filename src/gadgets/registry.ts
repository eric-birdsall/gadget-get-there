import { USAGE_CONFIG } from '../config';
import { GrappleGadget } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { RollerbladeGadget } from './rollerblades';
import { type GadgetDefinition, GadgetId } from './types';

export const GADGETS: readonly GadgetDefinition[] = [
  {
    id: GadgetId.Grapple,
    displayName: 'Grappling Hook',
    actionHint: 'Hold E on a glowing anchor to swing · release to let go',
    slot: 1,
    budgetLabel: `x${USAGE_CONFIG.grappleSwings}`,
    create: () => new GrappleGadget(),
  },
  {
    id: GadgetId.Rollerblades,
    displayName: 'Rollerblades',
    actionHint: 'E to put the skates on · then hold E to tuck for speed',
    slot: 2,
    budgetLabel: `${USAGE_CONFIG.rollerbladeSeconds}s`,
    create: () => new RollerbladeGadget(),
  },
  {
    id: GadgetId.LaunchPad,
    displayName: 'Launch Pad',
    actionHint: 'E to throw a pad · it launches you the way you faced',
    slot: 3,
    budgetLabel: `x${USAGE_CONFIG.padLaunches}`,
    create: () => new LaunchPadGadget(),
  },
];

export const DEFAULT_GADGET = GadgetId.Grapple;
export const DEFAULT_LOADOUT: readonly GadgetId[] = [GadgetId.Grapple, GadgetId.LaunchPad, GadgetId.Rollerblades];

export function gadgetDefinition(id: GadgetId): GadgetDefinition {
  return GADGETS.find((g) => g.id === id) ?? GADGETS[0];
}

export function isGadgetId(v: unknown): v is GadgetId {
  return GADGETS.some((g) => g.id === v);
}
