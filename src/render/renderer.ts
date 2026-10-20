import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Fog,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ABILITY_CONFIG, CAMERA_CONFIG, GRAPPLE_CONFIG } from '../config';
import type { CourseDefinition } from '../course/types';
import type { Pad } from '../gadgets/launchPad';
import type { GhostPose } from '../game/ghost';
import { type Box, SurfaceKind, raycast } from '../sim/collision';
import { ThirdPersonCamera } from './camera';
import { CityBackdrop, cityCourseDressing } from './city';
import { gridMaterial } from './materials';
import { THEMES, type Theme } from './theme';
import { BlobShadow, PlayerModel, type PlayerPose } from './playerModel';
import { KillBoundary } from './killBoundary';
import { SPACE_COLOR, SpaceBackdrop } from './space';
import { killPlaneY } from '../game/session';
import { CheckpointFlags, GhostView, GrappleMarker, MARKER_COLORS, PadViews, RopeView, finishGate } from './worldViews';

/** Everything the renderer needs to draw one frame. */
export interface RenderFrame {
  pose: PlayerPose;
  yaw: number;
  pitch: number;
  /** Landing speed this frame (0 if none), for squash. */
  landed: number;
  jumped: boolean;
  /** Jetpack burn 0…1 and dash flash 0…1, for the thruster flames. */
  thrust: number;
  dashFlash: number;
  gliding: boolean;
  sliding: boolean;
  crouching: boolean;
  /** Legs tucked up in the air (crouch held while jumping). */
  tucking: boolean;
  /** Sprint switched on. */
  sprinting: boolean;
  /** Mantle progress 0 … 1, or -1. */
  mantle: number;
  /** The wall being run on (its outward normal), or null. */
  wallRunNormal: Vector3 | null;
  /** Where the grapple would hook right now (in hand, in range), or null. */
  grappleTarget: { point: Vector3; normal: Vector3 } | null;
  /** Where the player's rope is fixed, or null. */
  grappleRope: Vector3 | null;
  pad: Pad | null;
  padEquipped: boolean;
  padPreview: { pos: Vector3; normal: Vector3 } | null;
  checkpointReached: number;
  ghost: GhostPose | null;
}

/** Below this camera distance the player model fades so it doesn't fill the screen. */
const FADE_DISTANCE = 1.8;

const SUN_DIRECTION = new Vector3(-0.45, 1, 0.35).normalize();
/** Half-size of the area the sun's shadow map covers, centred on the player. */
const SHADOW_EXTENT = 40;

/** Draws the course, the player and the sky. Owns the WebGL context and the camera. */
export class Renderer {
  readonly gl: WebGLRenderer;
  readonly scene = new Scene();
  readonly view = new ThirdPersonCamera();
  readonly player = new PlayerModel();
  private readonly shadow = new BlobShadow();
  private readonly sun: DirectionalLight;
  private readonly space: SpaceBackdrop;
  private readonly city: CityBackdrop;
  private readonly fill: HemisphereLight;
  /** The current world look. */
  theme: Theme = 'space';
  private course: CourseDefinition;
  /** The course's own materials, freed when it's rebuilt. */
  private courseMaterials: { dispose(): void }[] = [];
  private readonly down = new Vector3(0, -1, 0);
  private readonly probe = new Vector3();
  private readonly hand = new Vector3();
  private flags!: CheckpointFlags;
  /** The course's pieces, checkpoint flags and finish gate: swapped out when the level changes. */
  private courseGroup = new Group();
  private readonly grappleMarker = new GrappleMarker();
  private readonly rope = new RopeView(MARKER_COLORS.rope);
  private readonly pads = new PadViews();
  private readonly ghost = new GhostView();
  private readonly killBoundary = new KillBoundary();

  constructor(
    private boxes: readonly Box[],
    course: CourseDefinition,
  ) {
    this.course = course;
    this.gl = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.outputColorSpace = SRGBColorSpace;
    this.gl.toneMapping = ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.05;
    this.gl.shadowMap.enabled = true;
    this.gl.shadowMap.type = PCFSoftShadowMap;
    document.body.prepend(this.gl.domElement);

    // Space: a dark fog so distant pieces fade into the sky, cool fill light and a bright sun.
    this.scene.background = new Color(SPACE_COLOR);
    this.scene.fog = new Fog(SPACE_COLOR, 220, 900);
    this.fill = new HemisphereLight('#a9b8ff', '#2a2050', 1.25);
    this.scene.add(this.fill);
    this.sun = new DirectionalLight('#fff6e8', 3.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = sc.bottom = -SHADOW_EXTENT;
    sc.right = sc.top = SHADOW_EXTENT;
    sc.near = 1;
    sc.far = 200;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target);

    this.space = new SpaceBackdrop(this.scene, this.boxes);
    this.city = new CityBackdrop(this.scene, this.boxes);
    this.city.visible = false;
    this.setCourse(boxes, course, false);
    this.scene.add(this.grappleMarker.group, this.killBoundary.mesh);
    this.scene.add(this.player.root, this.shadow.mesh, this.rope.mesh, this.pads.group, this.ghost.group);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  /** Draws a different course (the level selector). */
  setCourse(boxes: readonly Box[], course: CourseDefinition, newAsteroids = true): void {
    this.scene.remove(this.courseGroup);
    this.courseGroup.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose();
    });
    for (const m of this.courseMaterials) m.dispose();
    this.courseMaterials = [];
    this.boxes = boxes;
    this.course = course;
    this.courseGroup = new Group();
    this.buildCourse();
    this.flags = new CheckpointFlags(course.checkpoints);
    this.courseGroup.add(this.flags.group, finishGate(course.finish));
    this.scene.add(this.courseGroup);
    this.killBoundary.setHeight(killPlaneY(boxes));
    if (newAsteroids) {
      this.space.setCourse(boxes);
      this.city.setCourse(boxes);
    }
  }

  /** Space or the city at night: colours, light, haze and backdrop. The course is rebuilt in the new look. */
  setTheme(theme: Theme): void {
    if (theme === this.theme) return;
    this.theme = theme;
    const look = THEMES[theme];
    (this.scene.background as Color).set(look.background);
    const fog = this.scene.fog as Fog;
    fog.color.set(look.fog.color);
    fog.near = look.fog.near;
    fog.far = look.fog.far;
    this.fill.color.set(look.fill.sky);
    this.fill.groundColor.set(look.fill.ground);
    this.fill.intensity = look.fill.intensity;
    this.sun.color.set(look.sun.color);
    this.sun.intensity = look.sun.intensity;
    this.space.visible = theme === 'space';
    this.city.visible = theme === 'city';
    this.setCourse(this.boxes, this.course, false);
  }

  private buildCourse(): void {
    const look = THEMES[this.theme];
    const materials = new Map<SurfaceKind, MeshStandardMaterial>();
    const edgeMaterials = new Map<SurfaceKind, LineBasicMaterial>();
    for (const box of this.boxes) {
      let mat = materials.get(box.kind);
      if (!mat) materials.set(box.kind, (mat = gridMaterial(box.kind, look)));
      let edgeMat = edgeMaterials.get(box.kind);
      if (!edgeMat) {
        const c = new Color(look.surfaces[box.kind].line).multiplyScalar(look.edgeBrightness);
        edgeMaterials.set(box.kind, (edgeMat = new LineBasicMaterial({ color: c })));
      }
      const geo = new BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2);
      const mesh = new Mesh(geo, mat);
      mesh.position.copy(box.center);
      mesh.quaternion.copy(box.rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new LineSegments(new EdgesGeometry(geo), edgeMat));
      this.courseGroup.add(mesh);
    }
    this.courseMaterials.push(...materials.values(), ...edgeMaterials.values());
    // In the city, every rooftop has its building under it.
    if (this.theme === 'city') {
      const craneTops: Vector3[] = [];
      this.courseGroup.add(cityCourseDressing(this.course, this.boxes, this.city.facade, craneTops));
      this.city.setCraneTops(craneTops);
    }
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h);
    this.view.resize(w / h);
  }

  /** Puts the camera and model straight onto the player after a spawn. */
  snap(feet: Vector3, yaw: number): void {
    this.view.snap(feet);
    this.player.face(yaw);
  }

  setShadows(on: boolean): void {
    if (this.gl.shadowMap.enabled === on) return;
    this.gl.shadowMap.enabled = on;
    this.scene.traverse((o) => {
      const m = (o as Mesh).material as MeshStandardMaterial | undefined;
      if (m) m.needsUpdate = true;
    });
  }

  render(dt: number, f: RenderFrame): void {
    const pose = f.pose;
    const speed = pose.vel.length();
    // Low stances drop the camera; a tuck raises the feet with the head still, so the camera holds
    // where it was by dropping the same amount.
    const drop = f.sliding || f.crouching ? 0.6 : f.tucking ? ABILITY_CONFIG.tuckLift : 0;
    this.view.pivotDrop += (drop - this.view.pivotDrop) * Math.min(1, dt * 10);
    // Sprinting widens the view a few degrees.
    this.view.fovBoost += ((f.sprinting ? CAMERA_CONFIG.sprintFovBoost : 0) - this.view.fovBoost) * Math.min(1, dt * 6);
    this.player.setSprint(f.sprinting, dt);
    this.view.update(dt, pose.feet, speed, f.yaw, f.pitch, this.boxes);
    this.player.setStance(f.sliding, f.crouching, f.mantle, dt, f.tucking);
    this.player.setWallRun(f.wallRunNormal, dt);
    this.player.setThrusters(f.thrust, f.dashFlash, dt);
    this.player.setGlide(f.gliding, dt);
    this.player.update(dt, pose, f.landed, f.jumped);
    const camDist = this.view.camera.position.distanceTo(this.probe.set(pose.feet.x, pose.feet.y + 1, pose.feet.z));
    this.player.setOpacity(Math.min(1, Math.max(0.15, camDist / FADE_DISTANCE)));

    this.probe.copy(pose.feet);
    this.probe.y += 0.3;
    const hit = raycast(this.boxes, this.probe, this.down, 60);
    this.shadow.place(hit?.point ?? null, hit?.normal ?? null, hit ? hit.distance - 0.3 : 0);

    this.grappleMarker.update(dt, f.grappleTarget);
    this.hand.set(pose.feet.x, pose.feet.y + GRAPPLE_CONFIG.handHeight, pose.feet.z);
    this.rope.set(f.grappleRope ? this.hand : null, f.grappleRope);
    this.pads.update(dt, f.pad, f.padPreview, !!f.padPreview, f.padEquipped);
    this.flags.setReached(f.checkpointReached);
    this.ghost.update(dt, f.ghost, GRAPPLE_CONFIG.handHeight);

    // Keep the sun's shadow map centred on the player.
    this.sun.target.position.copy(pose.feet);
    this.sun.position.copy(pose.feet).addScaledVector(SUN_DIRECTION, 100);

    this.space.update(dt, this.view.camera.position);
    this.city.update(dt, this.view.camera.position);
    this.killBoundary.update(dt, pose.feet);

    this.gl.render(this.scene, this.view.camera);
  }
}
