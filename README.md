# Gadget Get There

A third-person, physics-based time-trial platformer for the browser: run, jump and (soon) use one gadget per attempt to get from start to finish as fast as possible.

**Play:** https://eric-birdsall.github.io/gadget-get-there/

- Design spec: `~/Documents/gadget_speedrun_game_spec.md`
- Decisions that resolve the spec's open questions: [DECISIONS.md](DECISIONS.md)

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # Vitest: collision, movement, attempt state machine
npm run build      # typecheck + static build into dist/
```

Pushing to `main` runs the tests, builds, and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

Click **Play** to go fullscreen and capture the mouse. Esc pauses (the run clock freezes too) and a second Esc leaves fullscreen; Resume goes back in. In Chrome/Edge holding Esc also exits; Safari and Firefox exit fullscreen on the first Esc.

Pick up to three gadgets before a run. Each has a fixed budget on every level: Grapple x2 swings, Rollerblades 5 s (counted while the skates are on and you're on the ground), Launch Pad x1 launch. Switch between them any time with the scroll wheel (or 1 2 3); when one is used up, the next gadget with budget left takes over automatically, and used-up gadgets can't be picked again. Slot 1 is in hand at the start.

| Action | Keys |
|---|---|
| Move | W A S D (or arrows) |
| Look | Mouse |
| Jump | Space |
| Slide (at speed) / crouch-walk (when slow) | Hold Shift; jump out of a slide keeps its speed, and after 1 s of sliding (the crosshair ring glows) the jump adds a burst |
| Mantle a ledge | Hold Space in the air while moving into a ledge up to ~1 m above your head |
| Use gadget | E (grapple: hold to hook any surface under the crosshair · rollerblades: press to put on, then hold to tuck · launch pad: press to throw) |
| Choose gadgets | In the menu, click a gadget to put it in the next free slot; click it again (or its slot) to take it out. At the start line, 1 2 3 do the same. Changing gadgets from the menu mid-run restarts. Retries keep them. |
| Switch gadget | Scroll wheel (skips used-up ones), or 1 2 3 mid-run |
| Retry from start | R (or Enter) |
| Toggle ghost | G |
| Debug readout (speed, grounded…) | ` |
| Pause | Esc (a second Esc leaves fullscreen) |
| Settings | Settings button on the menu (Esc or Back returns); Tuning is in there |

If the browser refuses to capture the mouse (embedded panes do), the game plays with a visible cursor instead: mouse look works inside the window, and holding the cursor at or past the left/right edge keeps turning. A normal browser tab gives full mouse look.

URL flags: `?nolock` forces that free-cursor mode; `?dev` exposes `window.game` in the console.

## Tuning

Esc → **Settings** → **Tuning** opens a live panel over the movement, gadget and camera configs in [src/config.ts](src/config.ts). Changes are kept in this browser's local storage. **Copy changed values** puts the edits on the clipboard so they can go back into `config.ts`. **Reset to defaults** clears them.

## Layout

```
src/
  config.ts            every tunable number (movement, camera, world)
  sim/                 pure simulation, no DOM: unit-tested
    collision.ts       oriented boxes, capsule-vs-box contacts, raycasts
    player.ts          kinematic character controller (fixed 120 Hz tick)
  gadgets/             grappling hook, rollerblades, launch pad (one runtime per attempt)
  game/session.ts      attempt state machine, clock, checkpoints, finish, falls/respawn
  game/ghost.ts        PB ghost recording (20 Hz) and interpolated playback
  game/medals.ts       medal thresholds
  course/crossing.ts   "The Crossing", the course
  course/routeBot.ts   scripted player used by tests to prove every gadget can finish
  render/              Three.js scene, capsule-bot, camera, anchors/rope/pads/ghost/gate
  audio/audio.ts       procedural Web Audio SFX and music loop
  input/input.ts       remappable keyboard + pointer-lock mouse (free-cursor fallback)
  ui/                  HUD, finish card, pause menu, tuning panel
  storage/             versioned settings and personal bests that fail safe
```

## Status

Runs carry up to three gadgets with fixed budgets and free scroll-wheel switching, with gadget icons in the HUD and one personal best per level. Phases 0–5 of the spec are in place: movement and camera; The Crossing with checkpoints (ON/OFF setting) and a finish gate; the three gadgets; medals, personal bests per checkpoint mode and the PB ghost; procedural sound and music.

Character abilities (slide, crouch-walk, mantle) work with every gadget. The Crossing has two optional ability spots: blocks across the central gap that only a mantle reaches, and a barrier on the final platform with a slide-under slot.

The route-bot tests in `src/course/crossing.test.ts` finish The Crossing without falling on the plain running line with each gadget, on each gadget's own faster line, and on an ability line (mantle + slide). Rough bot times: running ≈ 46 s, grapple ≈ 36 s, rollerblades ≈ 36 s, launch pad ≈ 40 s, abilities ≈ 43 s. Medal thresholds (gold 32 s / silver 40 s / bronze 55 s) are placeholders until real playtests.

## Future ideas

- **Main mode: gadget loadouts.** A level selector where you pick 1–5 gadgets in a set order before the round starts. Each gadget has a limited usage (for example 5 seconds of rollerblades, 2 grapple shots, 1 launch pad). When it runs out you switch to the next gadget automatically, and the HUD always shows what's next. This replaces the spec's one-gadget-per-run rule as the main way to play.
- **Training mode:** today's free play, one gadget with unlimited use, for practising and testing each gadget.
