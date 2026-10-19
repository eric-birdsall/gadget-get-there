import { GadgetId } from '../gadgets/types';

// Simple white line icons, drawn on a 24×24 grid. They inherit `currentColor`.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const GADGET_ICONS: Record<GadgetId, string> = {
  // A hook on a rope.
  [GadgetId.Grapple]: svg('<circle cx="12" cy="3" r="1.4"/><path d="M12 4.5V13"/><path d="M12 13v2.5a4.5 4.5 0 0 1-9 0V14"/><path d="M3 14l2.2 2"/><path d="M12 15.5a4.5 4.5 0 0 0 9 0V14"/><path d="M21 14l-2.2 2"/>'),
  // A skate boot on wheels.
  [GadgetId.Rollerblades]: svg('<path d="M6 3h5v7l6.2 2.6A2.5 2.5 0 0 1 19 15v1.5H5V3"/><path d="M11 7h-2"/><circle cx="7.5" cy="20" r="1.6"/><circle cx="12" cy="20" r="1.6"/><circle cx="16.5" cy="20" r="1.6"/>'),
  // A pad with an arrow shooting up.
  [GadgetId.LaunchPad]: svg('<ellipse cx="12" cy="19" rx="8.5" ry="2.8"/><path d="M12 15.5V3.5"/><path d="M7.5 8l4.5-4.5L16.5 8"/>'),
};
