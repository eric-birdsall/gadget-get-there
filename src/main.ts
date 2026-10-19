import { Vector3 } from 'three';
import { GameAudio, Sfx } from './audio/audio';
import { ABILITY_CONFIG, CAMERA_CONFIG, DT, MAX_FRAME_SECONDS } from './config';
import { crossing } from './course/crossing';
import { GrappleGadget, findGrappleTarget } from './gadgets/grapple';
import { LaunchPadGadget, padPlacement } from './gadgets/launchPad';
import { DEFAULT_GADGET, GADGETS, cycleGadget, isGadgetId } from './gadgets/registry';
import { RollerbladeGadget } from './gadgets/rollerblades';
import { GadgetEvent, type GadgetId } from './gadgets/types';
import { type GhostPose, GhostPlayer } from './game/ghost';
import { medalFor } from './game/medals';
import { type AnyEvent, AttemptState, RunSession, type SessionInput, SessionEvent } from './game/session';
import { Action, InputManager } from './input/input';
import { Renderer } from './render/renderer';
import { Stance } from './sim/player';
import { RecordStore, checkpointMode } from './storage/records';
import { loadSettings, saveSettings } from './storage/settings';
import { Hud } from './ui/hud';
import { Menu } from './ui/menu';
import { TuningPanel, loadTuning } from './ui/tuning';

loadTuning();
const course = crossing;
const settings = loadSettings();
const records = new RecordStore();
const session = new RunSession(course, {
  gadget: isGadgetId(settings.gadget) ? settings.gadget : DEFAULT_GADGET,
  checkpointsEnabled: settings.checkpoints,
});
const renderer = new Renderer(session.boxes, course, session.anchors);
const input = new InputManager(renderer.canvas);
const hud = new Hud();
const tuning = new TuningPanel();
const audio = new GameAudio();

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
const ghostPose: GhostPose = { pos: new Vector3(), yaw: 0, anchor: -1 };

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

/** PB line, menu bests and ghost for the category this attempt counts in. */
function refreshCategory(): void {
  const best = records.best(course.id, checkpointMode(session.checkpointsEnabled));
  hud.setPersonalBest(best?.seconds ?? null, session.checkpointsEnabled);
  menu.setBests(records.best(course.id, checkpointMode(true))?.seconds ?? null, records.best(course.id, checkpointMode(false))?.seconds ?? null);
  ghost = best?.ghost ? new GhostPlayer(best.ghost) : null;
}

function refreshGadget(): void {
  hud.setGadgets(session.gadget.id, session.nextGadget);
  menu.setGadget(session.gadget.id, session.nextGadget);
}

function selectGadget(id: GadgetId): void {
  if (id === session.nextGadget) return;
  session.selectGadget(id);
  settings.gadget = id;
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
  const mode = checkpointMode(r.checkpointsEnabled);
  const previous = records.best(course.id, mode);
  const newBest = records.submit(course.id, mode, { seconds: r.seconds, gadget: r.gadget, date: Date.now(), ghost: r.ghost });
  hud.showResult({
    seconds: r.seconds,
    medal: medalFor(r.seconds, course.medalThresholds),
    previousBest: previous?.seconds ?? null,
    newBest,
    gadget: r.gadget,
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

const menu = new Menu(settings, {
  play: () => {
    audio.start();
    input.lock();
  },
  restart: () => {
    restart();
    audio.start();
    input.lock();
  },
  tuning: () => tuning.toggle(),
  selectGadget,
  settingsChanged: applySettings,
});

// The game runs only while the mouse is captured; losing it (Esc, alt-tab) is a true pause.
document.addEventListener('pointerlockchange', () => {
  paused = !input.locked;
  audio.setPaused(paused);
  document.body.classList.toggle('hide-cursor', !paused && input.usingFreeCursor);
  if (paused) menu.show(started);
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
  const slots = [Action.Slot1, Action.Slot2, Action.Slot3];
  slots.forEach((a, i) => {
    if (input.consumePress(a) && GADGETS[i]) selectGadget(GADGETS[i].id);
  });
  if (input.consumePress(Action.NextGadget)) selectGadget(cycleGadget(session.nextGadget, 1));
  if (input.consumePress(Action.PrevGadget)) selectGadget(cycleGadget(session.nextGadget, -1));
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
  const grappleTarget = grapple && !grapple.attached && live ? findGrappleTarget(session.anchors, session.boxes, aimOrigin, aimDir, p) : -1;
  const padPreview = pads && live ? padPlacement(session.boxes, aimOrigin, aimDir, p) : null;
  const showGhost = settings.ghost && ghost !== null;
  renderer.render(paused ? 0 : dt, {
    pose: { feet: drawFeet, vel: p.vel, grounded: p.grounded },
    yaw: input.yaw,
    pitch: input.pitch,
    landed: landedSpeed,
    jumped,
    skates: g instanceof RollerbladeGadget,
    tucking: g instanceof RollerbladeGadget && g.tucking && p.grounded,
    sliding: p.stance === Stance.Slide,
    crouching: p.stance === Stance.Crouch,
    mantle: p.mantle ? p.mantle.t / ABILITY_CONFIG.mantleDuration : -1,
    grappleEquipped: !!grapple,
    grappleTarget,
    grappleAttached: grapple?.anchorIndex ?? -1,
    pad: pads?.pad ?? null,
    padEquipped: !!pads && live,
    padPreview,
    checkpointReached: session.checkpoint,
    ghost: showGhost ? ghost!.poseAt(session.elapsed, ghostPose) : null,
  });
  hud.setCrosshairLocked(grappleTarget >= 0);
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
  audio.update(p.vel.length(), g instanceof RollerbladeGadget && p.grounded, Math.hypot(p.vel.x, p.vel.z));
  requestAnimationFrame(frame);
}

applySettings();
refreshGadget();
onSpawned();
menu.show(false);
requestAnimationFrame(frame);

// ?dev exposes the game to the console, for poking at positions while tuning.
if (new URLSearchParams(location.search).has('dev')) Object.assign(window, { game: { session, input, renderer, records } });
