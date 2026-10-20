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

## Wall run and wall jump (built; a character ability, not a gadget)
- **Wall run:** airborne, moving at 7 m/s or more mostly along a near-vertical wall at your side, at least 0.8 m above any floor.
  - You run along the wall for up to **1.4 s**, at the speed you came in with.
  - Gravity drops to 15%, so you hold height. The body leans into the wall.
  - It ends when the wall runs out, time's up, you slow below 5 m/s, or you land.
- **Wall jump:** jump while wall running, or while touching a wall at your side in the air.
  - You kick off at 8 m/s away and 9.5 m/s up, keeping your speed along the wall.
  - Air steering pauses for 0.3 s so the kick carries you clear.
  - You can't run on or kick off the same wall twice in a row without landing or touching another wall.
  - Walls straight ahead are for mantling, not kicking.
- **Course walls:**
  - a test wall along the start runway's right edge;
  - one beside the big gap in section 2;
  - five overlapping walls zigzagging across the bypass void. The bot crosses it in about 43 s overall, against about 46 s for plain running.

## Jetpack and Dash Thruster in; rollerblades out (built)
- **Rollerblades removed** completely. Saved bests and gadget orders that included them keep everything else.
- **Jetpack: 3 s of fuel.**
  - Hold E to thrust upward: 40 m/s² before gravity, climbing at up to 8 m/s. It lifts off from the ground too, and you steer as normal.
  - Fuel only burns while thrusting. Flames show under the backpack tanks, with a roar.
- **Dash Thruster: x3.**
  - Press E for a burst the way you're going (or looking, if standing still): 22 m/s, or your speed plus 8 if that's faster.
  - A dash never starts by dropping. There's a 0.35 s cooldown between dashes, and the flames flash blue.
- **Keys:** 1 Grapple, 2 Jetpack, 3 Launch Pad, 4 Dash; still up to 3 per run. Default loadout: Grapple, Jetpack, Dash.

## Checkpoint respawns restore gadgets (built)
- Reaching a checkpoint saves each gadget's use and which gadget is in hand. A respawn there restores exactly that (replacing "spent stays spent").
- A respawn before any checkpoint restores the full starting loadout, with the clock still running.

## Wingsuit (built): the fifth and final gadget
- **Budget: 6 s of glide**, counted only while gliding. Key 5.
- **Controls:** hold E in the air to glide. It does nothing on the ground: jump first, or hold it as you run off an edge.
- **Steering:** you glide where you look.
  - Level: sink 2.2 m/s at 15 m/s.
  - Looking down dives: up to about 13 m/s more sink and 11 m/s more speed.
  - Looking up flares: slower and floatier. It turns toward the camera heading at 1.8 rad/s.
- Gliding never counts as a fall.
- **Look:** orange wing membranes spread wrist to hip, and the body pitches belly-down about its middle, with a whoosh.
- **Gadget set:** Grapple, Jetpack, Launch Pad, Dash Thruster, Wingsuit. You pick 3 of 5.

## F cycles gadgets (built)
- **F** steps to the next gadget in slot order, skipping used-up ones, the same as one scroll down. WASD stays for movement; R stays as retry.

## Wall run: lean away, hold height (built)
- The body leans **away** from the wall (feet on it, top tilted out), so it never sinks into the wall.
- At **9 m/s or more** along the wall, a wall run loses no height at all. The small rise at the start eases to level. Slower runs still sink gently.
- The bypass zigzag walls are taller (top +6 m, bottom −2 m), since chained kicks on fast runs now gain height.

## One use key per slot (built)
Replaces the gadget in hand, switching (scroll, F, 1–5 mid-run) and auto-switch.
- **E uses slot 1, Q slot 2, F slot 3** (rebindable). Slot order now decides which key a gadget is on.
- **1–5 add/remove gadgets at the start line only;** mid-run they do nothing, so a stray press can't wreck a run. The scroll wheel does nothing.
- **Using gadgets together:**
  - A **fresh press** of another gadget (with budget left) cuts the grapple rope: no release boost, the swing counts. Swing → dash, swing → glide, swing → jetpack in one press.
  - **Throwing a pad keeps the rope** (a throw doesn't move you). **Touching a pad while hooked** launches you and cuts the rope, no boost.
  - **Jetpack + wingsuit held:** the jetpack wins; the glide pauses without spending seconds and carries on when you let go of the jetpack.
  - **Hooking while the jetpack/wingsuit is held:** the hook takes and the held gadget pauses on the rope (held isn't a fresh press); it carries on once the rope comes off.
  - A dash during a glide fades back to glide speed (no special rule).
  - Gadgets tick in a fixed order (pad, grapple, dash, jetpack, wingsuit), whatever their slots, so the result never depends on slot order.
- **Aim previews** (hook marker, pad ghost) show for every gadget with budget left.
- **HUD:** each slot always shows its use key; a slot glows while its gadget works (hooked, thrusting, gliding, or just dashed/thrown). The start-line hint reads "1–5 add or remove gadgets · E / Q / F use them"; no hint mid-run. Menu slot cards are labelled E / Q / F.
- Saved bindings: an old custom "use gadget" key moves to slot 1; a key the player put elsewhere stays there, even if it's now a default.

## Keyboard look (built)
- **I J K L look up, left, down, right** (rebindable), alongside the mouse, so the game plays without a mouse.
- **Ramped:** a fresh press starts at a quarter of the full rate for fine aim and reaches the full rate (about 180°/s turning, 100°/s tilting) after 0.35 s.
- **Auto-level (on by default):** 0.6 s after letting go of up/down, the view eases back to the usual slight downward tilt. It never touches a tilt the mouse set.
- **Settings:** keyboard look speed (0.4–2×) and the auto-level toggle; invert look applies to keys too.
- Grapple aim assist only if playtesting shows keyboard aiming is too hard.

## Xbox controller (built)
- Through the browser's Gamepad API, alongside keyboard and mouse. Fixed mapping, not rebindable:
  - Left stick move (analog; the outer 8% counts as full), right stick look (squared response, then the keyboard-look ramp and auto-level).
  - A jump · B (hold) slide/crouch · RT slot 1 · LT slot 2 · RB slot 3 · View retry · Menu pause/resume.
- Triggers count past 30% travel; sticks have an 18% round deadzone.
- Browsers only allow fullscreen and mouse capture from a click or key, so Play is clicked once. Resuming with Menu plays on without capturing the mouse; the mouse then doesn't look.
- The browser only reports the controller after a button press on the page.
- Menus stay mouse/keyboard for now. Grapple aim assist only if stick aiming proves hard.

## Gadgets are chosen in the menu only (built)
- The 1–5 add/remove keys at the start line are gone, with their hint and Controls rows. Pick gadgets in the menu (Esc).
- Start-line hint: "E / Q / F use your gadgets"; with none chosen, "No gadgets · Esc to pick some". The info modal shows just the budget.

## Three levels and a level selector (built)
- **The Crossing** (downhill), **Ascent** (uphill) and **Gauntlet** (fast and flat). Each favours different gadgets; every level has a plain line any loadout can finish.
- **Ascent:** stair hops; an 8 m cliff (ramp round the right, three ledges to mantle, jetpack, or swing from a beam hung just out from the face so the rope clears the edge); a 12 m cliff (long ramp with a wall to run, or jetpack, or the grapple hauling you up the face); a last ramp to the finish. No wingsuit or pad shortcut: it's uphill.
- **Gauntlet:** two slide barriers (or round the ends); a 14 m gap down to an island (stones round the right, or dash/glide/pad/swing/wall-run); the plunge, a 14 m gap after a short kicker (ramp round the left, or a slide down the kicker into a slide-jump, or any gadget); a 24 m corridor between two walls (narrow bridge, or wall-run and kick across, swing, jetpack).
- **Selector:** a row of level cards above the gadgets in the menu, each with its best time and medal dot. Switching keeps the gadgets and puts you at the new start line (mid-run, it abandons the run). The last level played is remembered.
- Medal times scale from the bot's running time as on The Crossing (gold ≈ 0.69×, silver ≈ 0.86×, bronze ≈ 1.18×); placeholders until playtests.

## Controller: button labels and menu navigation (built)
- The game tracks the last device used (a key, a mouse click or a real mouse move vs. a controller button or stick). With the controller, every on-screen key label shows its button: RT / LT / RB on the gadget slots and hints, View for retry, Menu for pause/change gadgets. Actions with no button (ghost toggle) keep their key.
- Menus: D-pad or left stick moves to the next control that way, preferring ones in the same row (left/right) or column (up/down) and only then the nearest off to the side, so moves are predictable whatever the window size. Held, it repeats. Left/right adjusts a focused slider or dropdown; A presses; B goes back (gadget info → Controls → Settings), the same as Esc; Y opens a gadget's info. Each gadget is one stop: its small "i" button is skipped. A highlight ring marks the control (a class, so it shows even when the window isn't focused), and it returns to where it was when a pop-up closes.
- Play / Resume / Restart pressed with A resume like the Menu button (no fullscreen or mouse capture from a controller). Buttons held at that moment are ignored until let go, so A on Resume doesn't jump.

## Rebindable controller buttons (built)
- The Controls page has a **Controller** column. Jump, slide, the three slot buttons, retry and the ghost toggle each take one controller button; the movement and look rows show "Left stick" / "Right stick" (fixed). Menu always pauses and can't be bound (like Esc).
- Rebinding: press the cell (click, or A on the controller), then the button. Menu or Esc cancels, Backspace clears. A button already in use moves over, with the same note and row flash as keys. Saved apart from the keys (`gadget-get-there.pad-bindings`); Reset to defaults restores both.
- On-screen controller labels (RT / LT / RB…) follow the bindings. Menu navigation (D-pad/stick, A, B, Y) stays fixed.

## Choose your input; tuck; slide burst only on the jump (built)
- **Play with** (Settings → Controls): Mouse & keyboard, or Controller. The one not chosen is ignored in play (keys and mouse look don't act with the controller chosen; the controller does nothing, menus included, with keyboard chosen). Labels follow the choice. Esc still pauses, and the mouse still clicks menus (Play needs a click for fullscreen; with the controller chosen it doesn't capture the mouse). Pressing a controller button while set to keyboard shows a hint where to switch. Replaces automatic switching by last device used.
- **Tuck:** crouch held in the air pulls the legs up 0.5 m with the head where it was, so you clear 0.5 m more than a plain jump (the jump itself is no stronger). Letting go drops the legs back if there's room. Landing still holding crouch goes straight into a crouch or slide. Holding slide through a slide-jump tucks automatically. No mantle, wall run or wall jump while tucked.
- **Slide burst:** a slide no longer adds speed when it starts. Sliding 1 s stores a burst (+2.5 m/s, ring glows) used only by jumping out of that slide; standing up or dropping to a crouch loses it.
- Gauntlet's kicker before the plunge is steeper (18°, 4 m down over 12 m) so a slide down it carries a slide-jump across; a plain running jump still falls short (tested).

## Sprint (built): an ability, not a gadget
- **Toggle:** a press switches it on (with at least 20% stamina) and another switches it off. Top running speed 13 m/s instead of 10. It also switches off when stamina runs out, when you stop moving on the ground, and when you crouch or slide. It stays on through jumps.
- **Stamina:** 4 s of sprinting when full, drained only while sprint-running on the ground; refills from 0.6 s after sprint stops, empty to full in 3 s. A thin bar above the gadgets shows it while sprinting or refilling (cyan while sprinting, red below 20%).
- **Defaults:** Shift sprints and C crouches/slides on the keyboard; clicking the left stick sprints on the controller. A saved crouch still on the old Shift default moves to C; one the player changed stays. A controller save from before sprint gets L3 for it if that's free.
- A sprint press waits for the next sim tick, so on fast displays a toggle is never dropped.

## Slides: flat or downhill only (built)
- A slide only starts on flat or downhill ground; heading up anything steeper than about 2° along your travel, crouch is a crouch-walk. A slide that runs onto a climb ends in a crouch. Banked curves count as flat (their tilt is sideways).
- Flat: friction 1.2 m/s² (was 2.5), so a slide keeps most of its speed (10 m/s is still ~8.8 after a second).
- Downhill: a slide gets 0.35 of gravity along the slope (was 0.9): a slight gain, about +0.6 m/s² on 12°.
- Gauntlet's plunge is now crossed by sprinting in, sliding the kicker and slide-jumping (the route bot learned to sprint); a running jump, even sprinting, still falls short.

## Uphill slides; sprint you can see (built)
- Slides work uphill again: the slope pulls 0.9 of gravity against you (plus friction), so the slide slows steadily and keeps going right down to 1 m/s, then you're crouching (it never slides back down). Flat and downhill stay as before (1.2 m/s² friction; 0.35 of gravity downhill).
- Sprinting shows: the view widens 7°, the astronaut leans further forward and pumps its arms, faint cyan streaks flicker at the screen edges, and a » marker by the stamina bar lights up. All ease in and out; the effects rest while paused.
