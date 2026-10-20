// Short on-screen names for key codes (KeyboardEvent.code) and mouse buttons.

const NAMED: Record<string, string> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  CapsLock: 'Caps Lock',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  MetaLeft: 'L Cmd',
  MetaRight: 'R Cmd',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  Mouse0: 'Left click',
  Mouse1: 'Middle click',
  Mouse2: 'Right click',
  Mouse3: 'Mouse 4',
  Mouse4: 'Mouse 5',
};

/** "KeyE" → "E", "Digit1" → "1", "Numpad1" → "Num 1", "Mouse2" → "Right click". */
export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  if (/^Mouse\d+$/.test(code)) return `Mouse ${Number(code.slice(5)) + 1}`;
  return code;
}

/** Labels for a run of keys: "1–5" when they're consecutive digits, else "Z X C V B". */
export function keyRangeLabel(labels: readonly string[]): string {
  const digits = labels.every((l, i) => /^\d$/.test(l) && (i === 0 || Number(l) === Number(labels[i - 1]) + 1));
  if (digits && labels.length > 2) return `${labels[0]}–${labels[labels.length - 1]}`;
  return labels.join(' ');
}
