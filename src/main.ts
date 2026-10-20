import { Vector3 } from 'three';
import { GameAudio, Sfx } from './audio/audio';
import { ABILITY_CONFIG, CAMERA_CONFIG, DT, MAX_FRAME_SECONDS } from './config';
import { crossing } from './course/crossing';
import { GrappleGadget, findGrappleTarget } from './gadgets/grapple';
import { LaunchPadGadget, padPlacement } from './gadgets/launchPad';
import { DEFAULT_LOADOUT, GADGETS, isGadgetId } from './gadgets/registry';
import { DashGadget } from './gadgets/dash';
import { JetpackGadget } from './gadgets/jetpack';
import { GadgetEvent, type GadgetId } from './gadgets/types';
import { type GhostPose, GhostPlayer } from './game/ghost';
import { medalFor } from './game/medals';
import { type AnyEvent, AttemptState, MAX_SLOTS, RunSession, type SessionInput, SessionEvent } from './game/session';
import { Action, InputManager } from './input/input';
import { Renderer } from './render/renderer';
import { Stance } from './sim/player';
import { RecordStore } from './storage/records';
import { loadSettings, saveSettings } from './storage/settings';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { Fullscreen } from './ui/fullscreen';
import { TuningPanel, loadTuning } from './ui/tuning';

loadTuning();
const course = crossing;
const settings = loadSettings();
const records = new RecordStore();
/** The saved gadget order (possibly empty). Gadgets that no longer exist drop out. */
function savedLoadout(): GadgetId[] {
  if (settings.loadout === '') return [];
  const ids = [...new Set(settings.loadout.split(',').filter(isGadgetId))].slice(0, MAX_SLOTS);
  return ids.length > 0 ? ids : [...DEFAULT_LOADOUT];
}

const session = new RunSession(course, {
  loadout: savedLoadout(),
  checkpointsEnabled: settings.checkpoints,
});
const renderer = new Renderer(session.boxes, course);
const input = new InputManager(renderer.canvas);
const hud = new Hud();
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
  renderer.view.baseFov = settings.fov;
  renderer.setShadows(settings.shadows);
  hud.setDebugVisible(settings.showDebug);
  audio.setVolumes(settings.sfxVolume, settings.musicVolume);
  session.setCheckpointsEnabled(settings.checkpoints);
  refreshCategory();
}

/** PB line, menu best and ghost for this level. */
function refreshCategory(): void {
  const best = records.best(course.id);
  hud.setPersonalBest(best?.seconds ?? null);
  menu.setBest(best?.seconds ?? null);
  ghost = best?.ghost ? new GhostPlayer(best.ghost) : null;
}

function refreshGadget(): void {
  const ready = session.state === AttemptState.Ready;
  hud.setGadgets(
    session.loadout,
    session.slot,
    session.gadgets.map((g) => g.remaining),
    session.gadgets.map((g) => g.usageLabel),
    ready,
  );
  menu.setLoadout(session.loadout, !ready);
}

/** Add `id` to the next free slot, or take it out. From the menu mid-run, this restarts. */
function toggleGadget(id: GadgetId, fromMenu = false): void {
  if (session.state !== AttemptState.Ready) {
    if (!fromMenu) return;
    restart();
  }
  if (!session.toggleGadget(id)) return;
  settings.loadout = session.loadout.join(',');
  saveSettings(settings);
  refreshGadget();
  audio.play(Sfx.Select);
}

/** Camera behind the player after any spawn. */
function onSpawned(): void {
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
      case SessionEvent.SlideJumped:
        audio.play(Sfx.SlideJump);
        break;
      case SessionEvent.Mantled:
        audio.play(Sfx.Mantle);
        break;
      case SessionEvent.GadgetSwitched:
        audio.play(Sfx.Select);
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
function enterPlay(): void {
  audio.start();
  if (!fullscreen.active) {
    void fullscreen.enter();
    // Some embedded browsers neither grant nor refuse: check a moment later instead.
    window.setTimeout(() => {
      if (!fullscreen.active && !paused) hud.showToast("Fullscreen isn't available here · playing in the window", 2.5);
    }, 1200);
  }
  input.lock();
}

const menu = new Menu(settings, {
  play: enterPlay,
  restart: () => {
    restart();
    enterPlay();
  },
  tuning: () => tuning.toggle(),
  toggleGadget: (id) => toggleGadget(id, true),
  clearGadgets: () => {
    if (session.state !== AttemptState.Ready) restart();
    if (!session.clearGadgets()) return;
    settings.loadout = '';
    saveSettings(settings);
    refreshGadget();
    audio.play(Sfx.Select);
  },
  settingsChanged: applySettings,
});

// First Esc pauses (still fullscreen); a second Esc, on the pause menu, leaves fullscreen.
document.addEventListener(
  'keydown',
  (e) => {
    if (e.code !== 'Escape') return;
    if (!paused) {
      e.preventDefault();
      input.unlock();
    } else if (menu.settingsOpen) {
      // Esc in settings goes back to the menu rather than leaving fullscreen.
      e.preventDefault();
      menu.showSettings(false);
    } else if (performance.now() - pausedAt > 250) {
      fullscreen.exit();
    }
  },
  true,
);
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
  if (paused) menu.show(started, pauseNote());
  else {
    started = true;
    menu.hide();
    hud.setFreeCursorNotice(input.usingFreeCursor);
  }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && input.locked) input.unlock();
});
input.onLockError = (switchedToFreeCursor) => {
  if (!switchedToFreeCursor) menu.show(started, "The browser didn't capture the mouse. Click again in a moment.");
};

function readInput(jumpPressed: boolean, actionPressed: boolean): SessionInput {
  return {
    forward: input.axis(Action.Forward, Action.Back),
    right: input.axis(Action.Right, Action.Left),
    yaw: input.yaw,
    jump: input.isHeld(Action.Jump) || jumpPressed,
    crouch: input.isHeld(Action.Crouch),
    action: input.isHeld(Action.Gadget) || actionPressed,
    actionPressed,
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
  // 1 2 3 4: at the start line, add that gadget to the next free slot or take it out; mid-run,
  // take it in hand. The scroll wheel steps through the slots, skipping used-up gadgets.
  const slots = [Action.Slot1, Action.Slot2, Action.Slot3, Action.Slot4];
  slots.forEach((a, i) => {
    if (!input.consumePress(a) || !GADGETS[i]) return;
    if (session.state === AttemptState.Ready) toggleGadget(GADGETS[i].id);
    else session.selectGadget(GADGETS[i].id);
  });
  const wheel = input.consumeWheel();
  for (let i = 0; i < Math.abs(wheel); i++) session.cycleGadget(wheel > 0 ? 1 : -1);
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

  if (!paused) {
    handleKeys();
    input.update(dt);
    // Taps shorter than a tick still count, on the first tick of this frame.
    let jumpPressed = input.consumePress(Action.Jump);
    let actionPressed = input.consumePress(Action.Gadget);
    accumulator += dt;
    while (accumulator >= DT) {
      prevFeet.copy(session.player.pos);
      handle(session.step(readInput(jumpPressed, actionPressed)));
      jumpPressed = actionPressed = false;
      accumulator -= DT;
    }
  }
  input.endFrame();

  const p = session.player;
  const g = session.gadget;
  drawFeet.lerpVectors(prevFeet, p.pos, paused ? 1 : accumulator / DT);
  const grapple = g instanceof GrappleGadget ? g : null;
  const pads = g instanceof LaunchPadGadget ? g : null;
  const live = session.state !== AttemptState.Finished;
  const canHook = grapple && !grapple.attached && grapple.remaining > 0 && live;
  const grappleTarget = canHook ? findGrappleTarget(session.boxes, aimOrigin, aimDir, p) : null;
  const padPreview = pads && live ? padPlacement(session.boxes, aimOrigin, aimDir, p) : null;
  const showGhost = settings.ghost && ghost !== null;
  renderer.render(paused ? 0 : dt, {
    pose: { feet: drawFeet, vel: p.vel, grounded: p.grounded },
    yaw: input.yaw,
    pitch: input.pitch,
    landed: landedSpeed,
    jumped,
    thrust: g instanceof JetpackGadget && g.thrusting ? 1 : 0,
    dashFlash: g instanceof DashGadget ? Math.max(0, 1 - g.sinceDash / 0.3) : 0,
    sliding: p.stance === Stance.Slide,
    crouching: p.stance === Stance.Crouch,
    mantle: p.mantle ? p.mantle.t / ABILITY_CONFIG.mantleDuration : -1,
    wallRunNormal: p.wallRun?.normal ?? null,
    grappleTarget,
    grappleRope: grapple?.point ?? null,
    // A thrown pad stays in the world after switching to another gadget.
    pad: session.gadgets.find((x): x is LaunchPadGadget => x instanceof LaunchPadGadget)?.pad ?? null,
    padEquipped: !!pads && live,
    padPreview,
    checkpointReached: session.checkpoint,
    ghost: showGhost ? ghost!.poseAt(session.elapsed, ghostPose) : null,
  });
  hud.setCrosshairLocked(grappleTarget !== null);
  // Slide charge: fills over the slide time that earns the jump burst.
  hud.setSlideCharge(p.stance === Stance.Slide ? Math.min(1, p.slideTime / ABILITY_CONFIG.slideJumpMinSeconds) : -1);
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
  audio.update(p.vel.length(), g instanceof JetpackGadget && g.thrusting);
  requestAnimationFrame(frame);
}

applySettings();
refreshGadget();
onSpawned();
menu.show(false);
requestAnimationFrame(frame);

// ?dev exposes the game to the console, for poking at positions while tuning.
if (new URLSearchParams(location.search).has('dev')) Object.assign(window, { game: { session, input, renderer, records } });
