import { GadgetId } from '../gadgets/types';

// Futuristic line icons on a 24×24 grid: thin strokes, angular shapes, small glowing cores.
// They inherit `currentColor`; the CSS adds the glow.

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const GADGET_ICONS: Record<GadgetId, string> = {
  // An angular three-pronged claw on a dashed energy cable, hanging from a glowing anchor.
  [GadgetId.Grapple]: svg(
    '<path d="M12 1.8l1.6 1.6L12 5 10.4 3.4z" fill="currentColor" fill-opacity="0.5"/>' +
      '<path d="M12 5.5v4.5" stroke-dasharray="1.2 1.3"/>' +
      '<rect x="10" y="10.2" width="4" height="3" rx="0.6"/>' +
      '<path d="M12 13.2v6.8l-1 1.2M12 20l1 1.2"/>' +
      '<path d="M10.6 14.5L6 17.5l-.6 3.2 2.3-1.6"/>' +
      '<path d="M13.4 14.5l4.6 3 .6 3.2-2.3-1.6"/>' +
      '<circle cx="12" cy="11.7" r="0.6" fill="currentColor" stroke="none"/>',
  ),
  // A sleek angular skate with a fin, glowing hub wheels and speed lines.
  [GadgetId.Rollerblades]: svg(
    '<path d="M7 3.5h4l1 5.5 6 2.5c1.2.5 2 1.4 2 2.5V16H6.5L7 3.5z"/>' +
      '<path d="M8.5 8h2.6M8.5 11h3.5"/>' +
      '<path d="M1.5 9.5h3M1 12.5h3.5M2 15.5h2.5"/>' +
      '<circle cx="8.5" cy="19.5" r="1.9"/><circle cx="13" cy="19.5" r="1.9"/><circle cx="17.5" cy="19.5" r="1.9"/>' +
      '<circle cx="8.5" cy="19.5" r="0.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="13" cy="19.5" r="0.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="17.5" cy="19.5" r="0.5" fill="currentColor" stroke="none"/>',
  ),
  // A hexagonal launch plate with an energy ring and stacked thrust chevrons.
  [GadgetId.LaunchPad]: svg(
    '<path d="M4 18.5l3-2.5h10l3 2.5-3 2.5H7z"/>' +
      '<ellipse cx="12" cy="18.5" rx="3.2" ry="1" fill="currentColor" fill-opacity="0.35"/>' +
      '<path d="M8 12.5l4-3.5 4 3.5"/><path d="M8.5 8l3.5-3 3.5 3" opacity="0.7"/><path d="M9.5 3.8l2.5-2 2.5 2" opacity="0.45"/>' +
      '<path d="M12 9v5" stroke-dasharray="1 1.4"/>',
  ),
};
