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

Pick up to three of the five gadgets before a run. Each has a fixed budget on every level: Grapple x2 swings, Jetpack 3 s of thrust, Launch Pad x1 launch, Dash Thruster x3 dashes, Wingsuit 6 s of glide. Each slot has its own use key: E for slot 1, Q for slot 2, F for slot 3, so there's no switching and gadgets can be combined (another gadget's press cuts the grapple rope; the jetpack beats the wingsuit when both are held). With checkpoints on, a respawn puts your gadgets back as they were when you reached that checkpoint.

| Action | Keys |
|---|---|
| Move | W A S D (or arrows) |
| Look | Mouse, or I J K L (a tap nudges, holding turns faster; after looking up/down with keys the view eases back to level, which Settings can turn off) |
| Jump | Space |
| Sprint | Shift toggles it (controller: click the left stick): 13 m/s instead of 10, with a wider view, a deeper lean and cyan streaks at the screen edges. A stamina bar (a » marker lights while sprinting) above the gadgets drains while you sprint-run (4 s full) and refills after you stop; sprint ends when it's empty, when you stop moving, or when you crouch or slide |
| Slide (from sprint speed) / crouch-walk (slower) | Hold C. A slide starts only at sprint speed; sprint stays on through it without using stamina. A slide keeps most of its speed on the flat, gains a little downhill, and uphill slows steadily to a stop (then you're crouching); jump out of a slide keeps its speed. Sliding 1 s stores a burst (the crosshair ring glows): jump out of the slide and it throws you +4.5 m/s the way you're steering (letting go of slide a split second before still counts); stand up any longer and it's gone |
| Tuck | Hold C in the air: legs up, head where it was, so you clear 0.5 m more than a plain jump; land still holding it and you're crouched |
| Wall run | Jump at a wall beside you while moving fast along it; you run along it for up to 1.4 s |
| Wall jump | Space while wall running (or touching a wall at your side in the air): kick off away and up |
| Mantle a ledge | Hold Space in the air while moving into a ledge up to ~1 m above your head |
| Use gadgets | E (slot 1), Q (slot 2), F (slot 3). Grapple: hold to hook any surface under the crosshair · jetpack: hold to thrust up · launch pad: press to throw · dash thruster: press to dash · wingsuit: hold in the air to glide |
| Choose gadgets | In the menu, click a gadget to put it in the next free slot; click it again (or its slot) to take it out. Changing gadgets from the menu mid-run restarts. Retries keep them. |
| Rebind keys | Settings → Key bindings |
| Retry from start | R (or Enter) |
| Toggle ghost | G |
| Debug readout (speed, grounded…) | ` |
| Pause | Esc (a second Esc leaves fullscreen) |
| Play with | Settings → Controls → Play with: Mouse & keyboard or Controller. The other is ignored until you switch (a hint shows if you press a controller button while set to keyboard). |
| Controller (Xbox layout) | Left stick move · right stick look · A jump · B slide/crouch · left stick click sprint · RT / LT / RB use slots 1 / 2 / 3 · Menu pause/resume · View retry. The buttons (not the sticks or Menu) can be rebound in Settings → Key bindings. In the menus: D-pad or left stick to move, A to press, B to go back, Y for a gadget's info (left/right adjusts sliders). With the controller chosen, on-screen labels show its buttons. Click Play once for fullscreen (the mouse isn't captured); starting from the controller plays on in the window. |
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
  course/crossing.ts   "The Crossing" (downhill)
  course/ascent.ts     "Ascent" (uphill: cliffs to climb)
  course/gauntlet.ts   "Gauntlet" (fast and flat: barriers, gaps, a wall corridor)
  course/courses.ts    the level list for the selector
  course/routeBot.ts   scripted player used by tests to prove every gadget can finish
  render/              Three.js scene, capsule-bot, camera, anchors/rope/pads/ghost/gate
  audio/audio.ts       procedural Web Audio SFX and music loop
  input/input.ts       remappable keyboard + pointer-lock mouse (free-cursor fallback)
  ui/                  HUD, finish card, pause menu, tuning panel
  storage/             versioned settings and personal bests that fail safe
```

## Status

Runs carry up to three gadgets with fixed budgets, one use key per slot, with gadget icons in the HUD and one personal best per level. Phases 0–5 of the spec are in place: movement and camera; The Crossing with checkpoints (ON/OFF setting) and a finish gate; the three gadgets; medals, personal bests per checkpoint mode and the PB ghost; procedural sound and music.

Character abilities (slide, crouch-walk, mantle) work with every gadget. The Crossing has two optional ability spots: blocks across the central gap that only a mantle reaches, and a barrier on the final platform with a slide-under slot.

Three levels, picked in the menu (each with its own personal best, medal and ghost): **The Crossing** (downhill, every gadget has a line), **Ascent** (uphill: two cliffs to mantle, grapple or jetpack up) and **Gauntlet** (fast and flat: slide under barriers, cross gaps by gadget or slide-jump, wall-run a corridor). `src/course/ascent.test.ts` and `gauntlet.test.ts` prove each one the same way: every gadget can finish on foot, and each faster line beats it. Bot running times: Ascent ≈ 30 s, Gauntlet ≈ 30 s.

The route-bot tests in `src/course/crossing.test.ts` finish The Crossing without falling on the plain running line with each gadget, on each gadget's own faster line, and on an ability line (mantle + slide). Rough bot times: running ≈ 46 s, grapple ≈ 36 s, rollerblades ≈ 36 s, launch pad ≈ 40 s, abilities ≈ 43 s. Medal thresholds (gold 32 s / silver 40 s / bronze 55 s) are placeholders until real playtests.

## Future ideas

- **Training mode:** today's free play, one gadget with unlimited use, for practising and testing each gadget.
- **Platform gadget (idea):** creates a temporary platform directly in front of the character that you can run, slide and jump on.
- **Rail boots (idea, name TBD):** boots that let you grind thin rails you couldn't otherwise stand on.
