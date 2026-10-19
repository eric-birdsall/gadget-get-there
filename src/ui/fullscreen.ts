// Fullscreen, with Esc kept for the game where the browser allows it (Chrome/Edge: Keyboard
// Lock). Holding Esc is always the browser's own way out. Safari and Firefox exit on one Esc.

interface KeyboardLock {
  lock(keys?: string[]): Promise<void>;
  unlock(): void;
}

export class Fullscreen {
  get active(): boolean {
    return !!document.fullscreenElement;
  }

  get supported(): boolean {
    return typeof document.documentElement.requestFullscreen === 'function' && document.fullscreenEnabled !== false;
  }

  /** Call from a click. Resolves whether the page is now fullscreen. */
  async enter(): Promise<boolean> {
    if (this.active) return true;
    if (!this.supported) return false;
    try {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    } catch {
      return false;
    }
    const keyboard = (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
    keyboard?.lock(['Escape']).catch(() => {});
    return true;
  }

  exit(): void {
    if (this.active) document.exitFullscreen().catch(() => {});
  }
}
