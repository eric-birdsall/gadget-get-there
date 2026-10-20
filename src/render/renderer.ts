import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Color,
  DirectionalLight,
  EdgesGeometry,
  Fog,
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
import { GRAPPLE_CONFIG } from '../config';
import type { CourseDefinition } from '../course/types';
import type { Pad } from '../gadgets/launchPad';
import type { GhostPose } from '../game/ghost';
import { type Box, SurfaceKind, raycast } from '../sim/collision';
import { ThirdPersonCamera } from './camera';
import { SURFACE_COLORS, gridMaterial } from './materials';
import { BlobShadow, PlayerModel, type PlayerPose } from './playerModel';
import { SPACE_COLOR, SpaceBackdrop } from './space';
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
  sliding: boolean;
  crouching: boolean;
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
  private readonly down = new Vector3(0, -1, 0);
  private readonly probe = new Vector3();
  private readonly hand = new Vector3();
  private readonly flags: CheckpointFlags;
  private readonly grappleMarker = new GrappleMarker();
  private readonly rope = new RopeView(MARKER_COLORS.rope);
  private readonly pads = new PadViews();
  private readonly ghost = new GhostView();

  constructor(
    private readonly boxes: readonly Box[],
    course: CourseDefinition,
  ) {
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
    this.scene.add(new HemisphereLight('#a9b8ff', '#2a2050', 1.25));
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

    this.buildCourse();
    this.space = new SpaceBackdrop(this.scene, this.boxes);
    this.flags = new CheckpointFlags(course.checkpoints);
    this.scene.add(this.flags.group, finishGate(course.finish), this.grappleMarker.group);
    this.scene.add(this.player.root, this.shadow.mesh, this.rope.mesh, this.pads.group, this.ghost.group);

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  get canvas(): HTMLCanvasElement {
    return this.gl.domElement;
  }

  private buildCourse(): void {
    const materials = new Map<SurfaceKind, MeshStandardMaterial>();
    const edgeMaterials = new Map<SurfaceKind, LineBasicMaterial>();
    for (const box of this.boxes) {
      let mat = materials.get(box.kind);
      if (!mat) materials.set(box.kind, (mat = gridMaterial(box.kind)));
      let edgeMat = edgeMaterials.get(box.kind);
      if (!edgeMat) {
        const c = new Color(SURFACE_COLORS[box.kind].line).multiplyScalar(0.7);
        edgeMaterials.set(box.kind, (edgeMat = new LineBasicMaterial({ color: c })));
      }
      const geo = new BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2);
      const mesh = new Mesh(geo, mat);
      mesh.position.copy(box.center);
      mesh.quaternion.copy(box.rot);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.add(new LineSegments(new EdgesGeometry(geo), edgeMat));
      this.scene.add(mesh);
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
    this.view.pivotDrop += ((f.sliding || f.crouching ? 0.6 : 0) - this.view.pivotDrop) * Math.min(1, dt * 10);
    this.view.update(dt, pose.feet, speed, f.yaw, f.pitch, this.boxes);
    this.player.setStance(f.sliding, f.crouching, f.mantle, dt);
    this.player.setWallRun(f.wallRunNormal, dt);
    this.player.setThrusters(f.thrust, f.dashFlash, dt);
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

    this.gl.render(this.scene, this.view.camera);
  }
}
