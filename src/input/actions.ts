// Everything a player can do with a key, mouse button or controller button.

export enum Action {
  Forward = 'forward',
  Back = 'back',
  Left = 'left',
  Right = 'right',
  Jump = 'jump',
  Crouch = 'crouch',
  /** Use the gadget in slot 1, 2 or 3. */
  UseSlot1 = 'use-slot-1',
  UseSlot2 = 'use-slot-2',
  UseSlot3 = 'use-slot-3',
  LookLeft = 'look-left',
  LookRight = 'look-right',
  LookUp = 'look-up',
  LookDown = 'look-down',
  Retry = 'retry',
  ToggleGhost = 'toggle-ghost',
  ToggleDebug = 'toggle-debug',
}
