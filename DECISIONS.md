# Gadget Get There — Design Decisions

Resolves the OPEN and PROPOSED items in `~/Documents/gadget_speedrun_game_spec.md` (v1.0). The spec stays the source of truth for everything not listed here.

## Platform & tech
- **Stack:** Vite + TypeScript + Three.js + Vitest, mirroring `../fps-go`. `npm run dev` locally; `npm run build` → static `dist/`.
- **Physics:** custom kinematic character controller with a fixed-tick sim (no physics library). Swept capsule vs. boxes, ramps, wedges. Banked curves are built from angled segments.
- **Input:** keyboard + mouse only (pointer lock). Gamepad and touch are out of scope.
- **Audience:** older kids / adults. The kids'-learning-game rules in `../CLAUDE.md` do not apply.

## Gadgets
- **Grappling hook:** attaches only to **predefined anchor nodes**, with aim assist (nearest anchor in a crosshair cone, within range, line of sight required; reticle highlight). **Pull + swing hybrid:** rope-length constraint plus a moderate reel-in. Release keeps velocity, plus a small capped boost. Hold LMB to stay attached; release LMB to detach. A miss fails softly.
- **Rollerblades:** **passive** low friction, extra slope acceleration, higher top speed, reduced turning grip; capped so there's no infinite gain on flat ground. **Hold LMB to tuck:** less drag and more downhill gain, very little steering.
- **Launch pad:** LMB **throws** a pad onto the ground surface under the crosshair (range-limited). **One active pad**; a new throw replaces it. The pad locks the camera's horizontal heading at throw time and launches along that heading at a fixed angle, keeping part of the player's horizontal speed. An invalid spot gives subtle feedback and no penalty.

## Run rules
- **Timer starts on first movement input** (WASD / Space / LMB). Mouse look does not start it.
- **Pause:** losing pointer lock (Esc, blur, tab hidden) is a **true pause**: sim and timer frozen, settings overlay shown, click to resume.
- **Medals:** shared gold/silver/bronze thresholds across checkpoint modes (placeholder 35/45/60 s, tune after playtesting).
- **PBs and ghosts:** stored separately per course + checkpoint mode. Each records the gadget used, and results label the mode.
- **Ghost:** one overall PB ghost per course + mode (not per gadget), labeled with its gadget.
- **Gadget switch while running:** 1–3 / Q / E queue the gadget for the next attempt (HUD shows "next: X"). `R` restarts immediately with the queued gadget.

## Presentation
- **Character:** abstract capsule-bot with a visor, procedural lean and squash/stretch.
- **Audio:** procedural Web Audio SFX (jump, land, grapple fire/attach, pad launch, checkpoint, finish, speed-scaled wind) **plus a simple procedural music loop**, with volume sliders for music and SFX.

## Build pacing
1. Phases 0–1 (skeleton, movement, camera, fall/respawn) → **check in for feel review**.
2. Phases 2–5 in one pass (course, run loop, gadgets, medals/PB/ghost, polish), verified in the browser and with Vitest.

## Made during the build
- **Course:** "The Crossing" drops from y 40 to y 10 over about 420 m, so downhill lines suit rollerblades. Big gaps are followed by long landings, so swing and launch speed carries.
- **Grapple feel:** reel 9 m/s with a 13 m/s² pull; release adds 2.5 m/s (capped at 30). The rope snaps if the course blocks the line.
- **Rollerblades:** push to 13 m/s on the flat. Pulling back brakes (14 m/s²), so speed stays controllable on narrow stones.
- **Falls:** besides the kill plane, a fall counts once you're 8 m below your last footing with nothing below and nothing along your arc. Never while on a rope.
- **After the finish:** the clock is frozen and the gadget is off. Coasting off an edge puts you back at the gate rather than discarding the result.
- **Gadget choice** is remembered between visits.

## Character abilities (built)
Separate from gadgets: they work whichever gadget is equipped.

**Slide (hold Shift)**
- At running speed (6 m/s or more), Shift starts a slide with a +3 m/s burst, at most once per ~1 s so it can't be spammed. Then low friction: momentum holds on the flat and grows downhill. Turning is limited.
- The slide ends when you let go of Shift or slow below 6 m/s. Below 6 m/s, Shift is a **crouch-walk** at 4 m/s.
- Sliding and crouching shrink the collision capsule to ~0.9 m, so you fit under low gaps. If there's no headroom you stay low until there is room to stand.
- Holding Shift in the air starts the slide on landing.
- **Jump out of a slide:** a normal jump that keeps full slide speed. No extra height.
- With rollerblades, a slide uses whichever friction is lower (slide or tuck). You can't slide while on a grapple rope.

**Mantle (hold Space)**
- Airborne, Space held, moving toward a ledge whose top is between waist height and about 1 m above your head: grab it and pull up in ~0.25 s.
- After the pull-up you keep ~60% of your horizontal speed, never less than running speed.
- Works on a grapple rope: a mantle ends the swing on the ledge.

**Course and feedback**
- The Crossing gets optional slide-under shortcuts and mantle-height ledges as faster lines. The existing routes stay possible without abilities, and the route-bot tests cover the new lines.
- Slide pose (leaning back, low) and a reach-and-pull-up mantle pose, plus slide hiss and grab-thud sounds. No new HUD elements.

## Fullscreen, gadget icons and 3-slot runs (built)

**Fullscreen**
- Play enters fullscreen as well as capturing the mouse.
- **First Esc pauses** (still fullscreen). **Second Esc** on the pause menu leaves fullscreen.
- Chrome/Edge: the Keyboard Lock API lets single Esc presses reach the game. Holding Esc ~2 s is the browser's own way out and always works.
- Safari/Firefox can't lock Esc: one press exits fullscreen. The game pauses and offers "Click to go fullscreen".
- If fullscreen is refused (e.g. embedded panes), play windowed with a small note.

**Gadget icons**
- Simple white line SVG icons: a hook on a rope, a skate, a pad with an up arrow. They replace gadget names in the HUD; names stay as tooltips and in menus.
- The current slot is highlighted, used slots are greyed and crossed out, and the rollerblade slot shows a countdown ring.

**3-slot runs on The Crossing** (replaces one gadget per run here; a one-gadget training mode can come back with the main mode)
- Each run has all three gadgets in a chosen order, each gadget exactly once.
- **Choosing the order:** at the start line, 1/2/3 puts that gadget in the first slot, swapping places with whatever was there. The pause menu has the same slots for clicking. The order locks when the clock starts.
- **One use each, then switch automatically** to the next slot:
  - **Grapple:** one swing, spent on release. Misses are free.
  - **Launch pad:** one launch. Re-throwing to adjust is free until it launches you.
  - **Rollerblades:** 5 s of rolling while on the ground. Air time doesn't count.
- When all three are used, finish on foot (abilities still work).
- A checkpoint respawn keeps the clock running and gadgets stay spent. R (a full retry) refills all three.
- **Personal best:** one PB (and one ghost) per level, whatever the checkpoint setting. The order used is saved with it and shown on the finish card. Existing one-gadget PBs are cleared.

## Picking gadgets (built)
- Click a gadget to put it in the next free slot; click it again, or click its slot, to take it out. Later slots move up. (This replaced drag and drop.)
- A run can carry 0–3 gadgets; with none you play on foot.
- At the start line, 1 2 3 add or remove gadgets the same way (Q / E no longer do anything).

## Rollerblades start on click (built)
- Rollerblades are off when they come up: you run normally and their 5 s doesn't count.
- The first click puts the skates on and starts the countdown. After letting go, holding click tucks as before.

## Gadget button is E (built)
- The gadget action moved from left click to **E**. (E no longer cycles gadgets; 1 2 3 add/remove them at the start line.)

## Gadget budgets with free switching (built)
Replaces "one use each, auto-switch in order".
- **Fixed budgets, the same on every level:** Rollerblades **5 s**, Grapple **x2** swings, Launch Pad **x1** launch.
  - Grapple misses are free; a swing counts on release.
  - Pad re-throws are free; the launch counts.
  - Blade seconds only run while the skates are on and you're on the ground.
- **Pick up to 3 gadgets before the run** (click to fill slots, Clear slots), as now. Slot 1 is in your hand at the start; slot order is the scroll order.
- **Switch freely mid-run, instantly:** the scroll wheel steps through the slots in order, wrapping and skipping used-up gadgets. 1/2/3 pick a gadget directly mid-run, and still add/remove gadgets at the start line.
- **Switching mid-action:**
  - Mid-swing: lets go of the rope, and the swing counts.
  - A thrown, unlaunched pad stays and still launches you, using its charge. Throw a pad, switch to blades, skate onto it.
  - Blades come off when you switch away. Switching back needs E again to put them on.
- **Running out:** the gadget stays in your hand, greyed, until you scroll. No auto-switch.
- **Checkpoint respawn:** budgets and the gadget in hand stay as they were; R refills everything.
- **Display:**
  - Menu gadget tiles show their budget ("5s", "x2", "x1").
  - The HUD shows remaining budget under each square ("3.2s", "x1", "x0"). The gadget in hand is highlighted, and its outline counts down.

## Slide jump burst and indicator (built)
- Jumping out of a slide that has lasted at least **1.0 s** adds **+2.5 m/s**.
- While sliding, a thin ring around the crosshair fills over that second. When full it turns bright cyan and glows, with a short chime.

## Grapple any surface (built)
- No more dedicated anchors. Hold E and the hook fixes to whatever surface is under the crosshair, if it's within **42 m** and the rope's path is clear. Floors, walls, undersides: anything. There's no aim assist.
- A glowing cyan ring marks where the hook would land, and the crosshair lights up, whenever the grapple is in hand with swings left.
- The Crossing floats gold **overhead beams, blocks and a ceiling** well above the path (out of jump reach) to swing from:
  - over the runway, the hops, the big gap, the left downhill and hub A;
  - across the central gap, over both bypass routes and the final ramp;
  - above the final corner.
- Ghost format v2 records where the rope is fixed; older ghosts are dropped (best times are kept).

## Space look (built)
- **Character:** an astronaut: white suit, gold mirrored visor, life-support backpack with twin tanks, orange suit stripe, glowing chest-panel lights.
- **Setting:** deep space instead of a blue sky. A galaxy band with dust lanes, purple and teal nebulae, about 6,000 twinkling stars, a ringed gas giant and a moon.
- **Space rocks:** about 160 tumbling asteroids around and below the course. They're kept at least 18 m from anything you can touch and are decoration only.
- **Meteors:** one streaks across the sky every few seconds.
- **Lighting and fog:** dark navy fog and a brighter, cooler light. Gameplay is unchanged.

## Auto-switch when used up (built)
- When the gadget in hand runs out, the next gadget (in slot order) with budget left takes over automatically. If none is left, you're on foot.
- Used-up gadgets can't be picked again: the scroll wheel skips them and 1/2/3 ignore them.
