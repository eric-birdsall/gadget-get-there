import { GrappleGadget } from './grapple';
import { LaunchPadGadget } from './launchPad';
import { RollerbladeGadget } from './rollerblades';
import { type GadgetDefinition, GadgetId } from './types';

export const GADGETS: readonly GadgetDefinition[] = [
  {
    id: GadgetId.Grapple,
    displayName: 'Grappling Hook',
    actionHint: 'Hold click on a glowing anchor to swing · release to let go',
    slot: 1,
    create: () => new GrappleGadget(),
  },
  {
    id: GadgetId.Rollerblades,
    displayName: 'Rollerblades',
    actionHint: 'Always rolling · hold click to tuck for speed',
    slot: 2,
    create: () => new RollerbladeGadget(),
  },
  {
    id: GadgetId.LaunchPad,
    displayName: 'Launch Pad',
    actionHint: 'Click to throw a pad · it launches you the way you faced',
    slot: 3,
    create: () => new LaunchPadGadget(),
  },
];

export const DEFAULT_GADGET = GadgetId.Grapple;

export function gadgetDefinition(id: GadgetId): GadgetDefinition {
  return GADGETS.find((g) => g.id === id) ?? GADGETS[0];
}

export function isGadgetId(v: unknown): v is GadgetId {
  return GADGETS.some((g) => g.id === v);
}

/** The next (or previous) gadget in selector order. */
export function cycleGadget(id: GadgetId, step: 1 | -1): GadgetId {
  const i = GADGETS.findIndex((g) => g.id === id);
  return GADGETS[(i + step + GADGETS.length) % GADGETS.length].id;
}
