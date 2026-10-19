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
