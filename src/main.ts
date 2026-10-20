import { Vector3 } from 'three';
import { GameAudio, Sfx } from './audio/audio';
import { ABILITY_CONFIG, CAMERA_CONFIG, DT, MAX_FRAME_SECONDS } from './config';
import { COURSES, courseById } from './course/courses';
import { GrappleGadget, findGrappleTarget } from './gadgets/grapple';
import { LaunchPadGadget, padPlacement } from './gadgets/launchPad';
import { DEFAULT_LOADOUT, isGadgetId } from './gadgets/registry';
import { DashGadget } from './gadgets/dash';
import { JetpackGadget } from './gadgets/jetpack';
import { WingsuitGadget } from './gadgets/wingsuit';
import { GadgetEvent, type GadgetId } from './gadgets/types';
import { type GhostPose, GhostPlayer } from './game/ghost';
import { medalFor } from './game/medals';
import { type AnyEvent, AttemptState, MAX_SLOTS, RunSession, type SessionInput, SessionEvent } from './game/session';
import { PadButton } from './input/gamepad';
import { Action, InputManager, USE_ACTIONS, device } from './input/input';
import { PadNav } from './ui/padNav';
import { CrouchToggle } from './input/crouchToggle';
import { FlyThrough } from './render/flythrough';
import { renderCoursePreviews } from './render/preview';
import { Renderer } from './render/renderer';
import { Stance, burstAvailable } from './sim/player';
import { RecordStore } from './storage/records';
import { loadBindings, loadPadBindings } from './storage/bindings';
import { loadSettings, saveSettings } from './storage/settings';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { Fullscreen } from './ui/fullscreen';
import { TuningPanel, loadTuning } from './ui/tuning';

loadTuning();
const settings = loadSettings();
let course = courseById(settings.level);
const bindings = loadBindings();
/** Controller buttons: shared with the input manager and labels, edited in place by the Controls page. */
const padBindings = loadPadBindings();
device.pad = padBindings;
const records = new RecordStore();
/** The saved gadget order (possibly empty). Gadgets that no longer exist drop out. */
function savedLoadout(): GadgetId[] {
  if (settings.loadout === '') return [];
  const ids = [...new Set(settings.loadout.split(',').filter(isGadgetId))].slice(0, MAX_SLOTS);
  return ids.length > 0 ? ids : [...DEFAULT_LOADOUT];
}

let session = new RunSession(course, {
  loadout: savedLoadout(),
  checkpointsEnabled: settings.checkpoints,
});
const renderer = new Renderer(session.boxes, course);
const input = new InputManager(renderer.canvas);
input.setBindings(bindings);
const hud = new Hud(bindings);
const tuning = new TuningPanel();
const audio = new GameAudio();
const fullscreen = new Fullscreen();
/** When the game last paused, so one Esc press can't both pause and leave fullscreen. */
let pausedAt = 0;

let started = false;
let paused = true;
let accumulator = 0;
const prevFeet = new Vector3();
const drawFeet = new Vector3();
const aimOrigin = new Vector3();
const aimDir = new Vector3();
// Animation cues gathered across the ticks of one frame.
let landedSpeed = 0;
let jumped = false;
let ghost: GhostPlayer | null = null;
const ghostPose: GhostPose = { pos: new Vector3(), yaw: 0, rope: null };

function applySettings(): void {
  input.sensitivity = settings.sensitivity;
  input.invertY = settings.invertY;
  setInputMode(settings.inputMode === 'pad' ? 'pad' : 'keys');
  input.keyLookSpeed = settings.keyLookSpeed;
  input.autoLevel = settings.autoLevel;
  renderer.view.baseFov = settings.fov;
  renderer.setShadows(settings.shadows);
  hud.setDebugVisible(settings.showDebug);
  audio.setVolumes(settings.sfxVolume, settings.musicVolume);
  session.setCheckpointsEnabled(settings.checkpoints);
  refreshCategory();
}

/** PB line, menu best and ghost for this level, and every level's best for the selector. */
function refreshCategory(): void {
  const best = records.best(course.id);
  hud.setPersonalBest(best?.seconds ?? null);
  menu.setBest(best?.seconds ?? null);
  menu.setLevels(
    COURSES.map((c) => {
      const pb = records.best(c.id);
      return {
        id: c.id,
        name: c.name,
        best: pb?.seconds ?? null,
        medal: pb ? medalFor(pb.seconds, c.medalThresholds) : null,
        thresholds: c.medalThresholds,
        bestLoadout: pb?.loadout ?? null,
        bestDate: pb?.date ?? null,
        bestCheckpoints: pb?.checkpoints ?? null,
      };
    }),
    course.id,
  );
  ghost = best?.ghost ? new GhostPlayer(best.ghost) : null;
}

/** Switches to another level, at its start line with the same gadgets. */
function selectLevel(id: string): void {
  const next = courseById(id);
  if (next.id === course.id) return;
  course = next;
  settings.level = course.id;
  saveSettings(settings);
  session = new RunSession(course, { loadout: [...session.loadout], checkpointsEnabled: settings.checkpoints });
  renderer.setCourse(session.boxes, course);
  hud.showResult(null);
  refreshCategory();
  refreshGadget();
  onSpawned();
  audio.play(Sfx.Select);
}

function refreshGadget(): void {
  const ready = session.state === AttemptState.Ready;
  hud.setGadgets(
    session.loadout,
    session.gadgets.map((g) => g.active),
    session.gadgets.map((g) => g.remaining),
    session.gadgets.map((g) => g.usageLabel),
    ready,
  );
  menu.setLoadout(session.loadout, !ready);
}

/** Add `id` to the next free slot, or take it out (from the menu). Mid-run, this restarts. */
function toggleGadget(id: GadgetId): void {
  if (session.state !== AttemptState.Ready) restart();
  if (!session.toggleGadget(id)) return;
  settings.loadout = session.loadout.join(',');
  saveSettings(settings);
  refreshGadget();
  audio.play(Sfx.Select);
}

/** Camera behind the player after any spawn. */
function onSpawned(): void {
  crouch.release();
  input.yaw = session.spawnYaw;
  input.pitch = CAMERA_CONFIG.defaultPitch;
  prevFeet.copy(session.player.pos);
  renderer.snap(session.player.pos, session.spawnYaw);
}

function restart(): void {
  handle(session.restart());
}

function finish(): void {
  const r = session.result!;
  const previous = records.best(course.id);
  const newBest = records.submit(course.id, {
    seconds: r.seconds,
    loadout: r.loadout,
    checkpoints: r.checkpointsEnabled,
    date: Date.now(),
    ghost: r.ghost,
  });
  hud.showResult({
    seconds: r.seconds,
    medal: medalFor(r.seconds, course.medalThresholds),
    previousBest: previous?.seconds ?? null,
    newBest,
    loadout: r.loadout,
    checkpoints: r.checkpointsEnabled,
    thresholds: course.medalThresholds,
  });
  audio.play(newBest ? Sfx.PersonalBest : Sfx.Finish);
  if (newBest) {
    // Update the PB line now, but keep showing the ghost just beaten until the retry.
    const old = ghost;
    refreshCategory();
    ghost = old;
  }
}

function handle(events: AnyEvent[]): void {
  for (const e of events) {
    switch (e) {
      case SessionEvent.Spawned:
        onSpawned();
        if (session.state === AttemptState.Ready) {
          hud.showResult(null);
          refreshCategory();
          refreshGadget();
        }
        break;
      case SessionEvent.Jumped:
        jumped = true;
        audio.play(Sfx.Jump);
        break;
      case SessionEvent.Landed:
        landedSpeed = Math.max(landedSpeed, session.player.landingSpeed);
        if (session.player.landingSpeed > 4) audio.play(Sfx.Land, session.player.landingSpeed);
        break;
      case SessionEvent.SlideStarted:
        audio.play(Sfx.Slide);
        break;
      case SessionEvent.WallRunStarted:
        audio.play(Sfx.WallRun);
        break;
      case SessionEvent.WallJumped:
        audio.play(Sfx.WallJump);
        break;
      case SessionEvent.SlideReady:
        audio.play(Sfx.SlideReady);
        break;
      case SessionEvent.SlideBurst:
        audio.play(Sfx.SlideBurst);
        // Feel the burst: the view punches wide and eases back.
        renderer.view.kick(8);
        break;
      case SessionEvent.Mantled:
        audio.play(Sfx.Mantle);
        break;
      case SessionEvent.Fell:
        audio.play(Sfx.Respawn);
        break;
      case SessionEvent.CheckpointReached:
        hud.showToast('Checkpoint');
        audio.play(Sfx.Checkpoint);
        break;
      case SessionEvent.Finished:
        finish();
        break;
      case GadgetEvent.GrappleAttached:
        audio.play(Sfx.GrappleFire);
        audio.play(Sfx.GrappleAttach);
        break;
      case GadgetEvent.GrappleMissed:
        audio.play(Sfx.GrappleMiss);
        break;
      case GadgetEvent.GrappleReleased:
        audio.play(Sfx.GrappleRelease);
        break;
      case GadgetEvent.GlideStarted:
        audio.play(Sfx.Glide);
        break;
      case GadgetEvent.Dashed:
        audio.play(Sfx.Dash);
        break;
      case GadgetEvent.PadPlaced:
        audio.play(Sfx.PadThrow);
        break;
      case GadgetEvent.PadInvalid:
        audio.play(Sfx.PadInvalid);
        hud.showToast("Can't place a pad there", 0.8);
        break;
      case GadgetEvent.PadLaunched:
        audio.play(Sfx.PadLaunch);
        break;
    }
  }
}

/** From a click: go fullscreen and capture the mouse. Plays in the window if fullscreen is refused. */
/** True while the controller is pressing a menu button (A): Play and Resume then resume as Menu does. */
let padActivating = false;

function enterPlay(): void {
  audio.start();
  // A controller press can't capture the mouse or go fullscreen: play on in the window.
  if (padActivating) {
    input.lockFromPad();
    return;
  }
  // Clicked Play to play with the controller: fullscreen, but the mouse isn't captured.
  if (input.device === 'pad') {
    if (!fullscreen.active) void fullscreen.enter();
    input.lockFromPad();
    return;
  }
  if (!fullscreen.active) {
    void fullscreen.enter();
    // Some embedded browsers neither grant nor refuse: check a moment later instead.
    window.setTimeout(() => {
      if (!fullscreen.active && !paused) hud.showToast("Fullscreen isn't available here · playing in the window", 2.5);
    }, 1200);
  }
  input.lock();
}

const menu = new Menu(settings, bindings, padBindings, {
  play: enterPlay,
  restart: () => {
    restart();
    enterPlay();
  },
  tuning: () => tuning.toggle(),
  toggleGadget,
  selectLevel,
  levelPreviews: () => renderCoursePreviews(COURSES),
  createFlyThrough: () => new FlyThrough(COURSES),
  clearGadgets: () => {
    if (session.state !== AttemptState.Ready) restart();
    if (!session.clearGadgets()) return;
    settings.loadout = '';
    saveSettings(settings);
    refreshGadget();
    audio.play(Sfx.Select);
  },
  settingsChanged: applySettings,
  bindingsChanged: () => {
    input.setBindings(bindings);
    hud.refreshKeys();
    refreshGadget();
  },
});

/**
 * Back one level in the menus (Esc, or B on the controller): out of the gadget info, the
 * Controls page, then settings. Returns false at the top level, with nothing to go back from.
 */
function menuBack(): boolean {
  if (menu.capturing) menu.cancelCapture();
  else if (menu.infoOpen) menu.closeInfo();
  else if (menu.levelsOpen) menu.closeLevels();
  else if (menu.controlsOpen) menu.showControls(false);
  else if (menu.settingsOpen) menu.showSettings(false);
  else return false;
  return true;
}

// First Esc pauses (still fullscreen); a second Esc, on the pause menu, leaves fullscreen.
document.addEventListener(
  'keydown',
  (e) => {
    if (e.code !== 'Escape') return;
    if (!paused) {
      e.preventDefault();
      input.unlock();
    } else if (menuBack()) {
      e.preventDefault();
    } else if (performance.now() - pausedAt > 250) {
      fullscreen.exit();
    }
  },
  true,
);

// The menus with the controller: D-pad or stick to move, A to press, B to go back.
const padNav = new PadNav({
  root: () => document.getElementById(menu.infoOpen ? 'info-modal' : menu.levelsOpen ? 'level-modal' : 'overlay')!,
  activate: (el) => {
    padActivating = true;
    try {
      el.click();
    } finally {
      padActivating = false;
    }
  },
  back: () => void menuBack(),
});

/** Plays with the controller or with mouse and keyboard; the other is ignored. Labels follow. */
function setInputMode(d: 'keys' | 'pad'): void {
  if (input.device === d) return;
  input.setDevice(d);
  document.body.classList.toggle('pad-nav', d === 'pad');
  hud.refreshKeys();
  menu.refreshKeys();
  refreshGadget();
  if (d === 'pad' && paused) padNav.focus(document.getElementById('play')!);
}
// Browsers without Esc lock leave fullscreen on one press: pause too.
document.addEventListener('fullscreenchange', () => {
  if (!fullscreen.active && !paused) input.unlock();
  if (paused) menu.show(started, pauseNote());
});

function pauseNote(): string {
  return started && !fullscreen.active && fullscreen.supported ? 'Resume to go back to fullscreen.' : '';
}

// The game runs only while the mouse is captured; losing it (Esc, alt-tab) is a true pause.
document.addEventListener('pointerlockchange', () => {
  paused = !input.locked;
  if (paused) pausedAt = performance.now();
  audio.setPaused(paused);
  document.body.classList.toggle('hide-cursor', !paused && input.usingFreeCursor);
  if (paused) {
    menu.show(started, pauseNote());
    if (input.device === 'pad') padNav.focus(document.getElementById('play')!);
  } else {
    started = true;
    menu.hide();
    // Only about mouse look: nothing to say when playing with the controller.
    hud.setFreeCursorNotice(input.usingFreeCursor && input.device === 'keys');
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && input.locked) input.unlock();
});
input.onLockError = (switchedToFreeCursor) => {
  if (!switchedToFreeCursor) menu.show(started, "The browser didn't capture the mouse. Click again in a moment.");
};

/** Crouch as a toggle (or held, by the setting). */
const crouch = new CrouchToggle();

/** A sprint press waiting for the next sim tick (frames can be shorter than a tick). */
let sprintPending = false;

function readInput(jumpPressed: boolean, usePressed: boolean[]): SessionInput {
  return {
    forward: input.moveForward,
    right: input.moveRight,
    yaw: input.yaw,
    jump: input.isHeld(Action.Jump) || jumpPressed,
    sprint: sprintPending,
    crouch: crouch.held(settings.crouchMode === 'hold' ? 'hold' : 'toggle', input.isHeld(Action.Crouch)),
    use: USE_ACTIONS.map((a, i) => input.isHeld(a) || usePressed[i]),
    usePressed,
    aimOrigin,
    aimDir,
  };
}

function handleKeys(): void {
  if (input.consumePress(Action.ToggleDebug)) {
    settings.showDebug = !settings.showDebug;
    saveSettings(settings);
    hud.setDebugVisible(settings.showDebug);
  }
  if (input.consumePress(Action.ToggleGhost)) {
    settings.ghost = !settings.ghost;
    saveSettings(settings);
    menu.syncCheckbox('ghost');
    hud.showToast(settings.ghost ? 'Ghost on' : 'Ghost off', 0.8);
  }
  if (input.consumePress(Action.Retry)) restart();
}

let last = performance.now();
let fps = 60;

function frame(now: number): void {
  const dt = Math.min(MAX_FRAME_SECONDS, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  landedSpeed = 0;
  jumped = false;

  // The crosshair ray, from where the camera was drawn last frame.
  const cam = renderer.view.camera;
  aimOrigin.copy(cam.position);
  cam.getWorldDirection(aimDir);

  // The controller's Menu button pauses and resumes (resuming can't capture the mouse or go
  // fullscreen: browsers only allow those from a click or key).
  input.pollPad();
  // Rebinding on the Controls page: the controller's buttons go there (Menu cancels).
  if (paused && menu.capturing) menu.onPadEdges(input.padEdges);
  else if (input.padEdges.has(PadButton.Menu)) {
    if (!paused) input.unlock();
    else if (!menu.capturing) {
      audio.start();
      input.lockFromPad();
    }
  } else if (paused) padNav.update(dt, input.padState, input.padEdges);
  // A controller pressed while set to mouse and keyboard: say where to switch.
  if (paused && input.padIgnored) {
    input.padIgnored = false;
    menu.showNote('Controller detected · to play with it, choose Controller under Play with');
  }
  if (!paused) {
    handleKeys();
    input.update(dt);
    // Taps shorter than a tick still count, on the first tick of this frame.
    let jumpPressed = input.consumePress(Action.Jump);
    let usePressed = USE_ACTIONS.map((a) => input.consumePress(a));
    // A toggle: one press is one switch, so it waits for a tick rather than being dropped.
    if (input.consumePress(Action.Sprint)) sprintPending = true;
    if (input.consumePress(Action.Crouch)) crouch.press(session.player.grounded);
    accumulator += dt;
    while (accumulator >= DT) {
      prevFeet.copy(session.player.pos);
      handle(session.step(readInput(jumpPressed, usePressed)));
      crouch.afterTick(session.player);
      sprintPending = false;
      jumpPressed = false;
      usePressed = USE_ACTIONS.map(() => false);
      accumulator -= DT;
    }
  }
  input.endFrame();

  const p = session.player;
  drawFeet.lerpVectors(prevFeet, p.pos, paused ? 1 : accumulator / DT);
  const live = session.state !== AttemptState.Finished;
  const grapple = session.find(GrappleGadget);
  const pads = session.find(LaunchPadGadget);
  const jetpack = session.find(JetpackGadget);
  const dash = session.find(DashGadget);
  // Aim previews for every gadget that can still be used.
  const canHook = grapple && !grapple.attached && grapple.remaining > 0 && live;
  const canThrow = !!pads && pads.remaining > 0 && live;
  const grappleTarget = canHook ? findGrappleTarget(session.boxes, aimOrigin, aimDir, p) : null;
  const padPreview = canThrow ? padPlacement(session.boxes, aimOrigin, aimDir, p) : null;
  const showGhost = settings.ghost && ghost !== null;
  renderer.render(paused ? 0 : dt, {
    pose: { feet: drawFeet, vel: p.vel, grounded: p.grounded },
    yaw: input.yaw,
    pitch: input.pitch,
    landed: landedSpeed,
    jumped,
    thrust: jetpack?.thrusting ? 1 : 0,
    dashFlash: dash ? Math.max(0, 1 - dash.sinceDash / 0.3) : 0,
    gliding: !!session.find(WingsuitGadget)?.gliding,
    sliding: p.stance === Stance.Slide,
    crouching: p.stance === Stance.Crouch,
    tucking: p.stance === Stance.Tuck,
    sprinting: p.sprinting,
    mantle: p.mantle ? p.mantle.t / ABILITY_CONFIG.mantleDuration : -1,
    wallRunNormal: p.wallRun?.normal ?? null,
    grappleTarget,
    grappleRope: grapple?.point ?? null,
    pad: pads?.pad ?? null,
    padEquipped: canThrow,
    padPreview,
    checkpointReached: session.checkpoint,
    ghost: showGhost ? ghost!.poseAt(session.elapsed, ghostPose) : null,
  });
  hud.setCrosshairLocked(grappleTarget !== null);
  // Slide charge: fills over the slide time that earns the jump burst.
  // The slide ring fills over the burst's slide time, and only glows when a burst is there to have.
  const charge = Math.min(1, p.slideTime / ABILITY_CONFIG.slideBurstMinSeconds);
  hud.setSlideCharge(p.stance === Stance.Slide ? (charge >= 1 && !burstAvailable(p) ? 0.98 : charge) : -1);
  // Paused, the sprint effects rest (the stamina bar still shows).
  hud.setStamina(p.stamina, p.sprinting && !paused);
  hud.update(session.state, session.elapsed);
  refreshGadget();
  hud.updateDebug({
    speed: p.vel.length(),
    hSpeed: Math.hypot(p.vel.x, p.vel.z),
    vSpeed: p.vel.y,
    grounded: p.grounded,
    state: session.state,
    fps,
    y: p.pos.y,
  });
  audio.update(p.vel.length(), !!jetpack?.thrusting);
  requestAnimationFrame(frame);
}

applySettings();
refreshGadget();
onSpawned();
menu.show(false);
requestAnimationFrame(frame);

// ?dev exposes the game to the console, for poking at positions while tuning.
if (new URLSearchParams(location.search).has('dev')) Object.assign(window, {
    game: {
      // A getter: switching levels replaces the session.
      get session() {
        return session;
      },
      input,
      renderer,
      records,
      menu,
    },
  });
