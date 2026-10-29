import {
  ACESFilmicToneMapping,
  Box3,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  type MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { CourseDefinition } from '../course/types';
import { Fog } from 'three';
import { makeBox } from '../sim/collision';
import { cityCourseDressing, facadeMaterial, nightSky } from './city';
import { PieceKit } from './pieces';
import { THEMES, type Theme } from './theme';
import { finishGate } from './worldViews';

// Level previews for the level picker: each course in a small scene of its own, apart from the
// game's. A still picture of each (from up behind the start, looking down the course) and, see
// flythrough.ts, a live fly-through on hover.

export const PREVIEW_WIDTH = 480;
export const PREVIEW_HEIGHT = 270;

/** A small renderer for previews: its canvas is the picture. */
export function previewRenderer(keepPicture = false): WebGLRenderer {
  const gl = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: keepPicture });
  gl.setPixelRatio(1);
  gl.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  return gl;
}

/** What a set of preview scenes share: the look, its materials, and (in the city) the building facade. */
export interface PreviewKit {
  theme: Theme;
  pieces: PieceKit;
  facade: MeshStandardMaterial | null;
}

export function previewKit(theme: Theme): PreviewKit {
  return { theme, pieces: new PieceKit(theme), facade: theme === 'city' ? facadeMaterial() : null };
}

export function disposeKit(kit: PreviewKit): void {
  kit.pieces.dispose();
  kit.facade?.dispose();
}

/** A course's pieces and finish gate, in the chosen look, lit like the game, in a scene of its own. */
export function buildCourseScene(course: CourseDefinition, kit: PreviewKit): { scene: Scene; bounds: Box3 } {
  const look = THEMES[kit.theme];
  const scene = new Scene();
  scene.background = new Color(look.background);
  scene.fog = new Fog(look.fog.color, look.fog.near * 1.4, look.fog.far * 1.4);
  scene.add(new HemisphereLight(look.fill.sky, look.fill.ground, look.fill.intensity * 1.1));
  const sun = new DirectionalLight(look.sun.color, look.sun.intensity * 0.87);
  sun.position.set(-0.45, 1, 0.35);
  scene.add(sun);
  const bounds = new Box3();
  const boxes = course.pieces.map(makeBox);
  for (const box of boxes) {
    scene.add(kit.pieces.mesh(box));
    bounds.expandByPoint(box.center);
  }
  scene.add(finishGate(course.finish));
  if (kit.facade) scene.add(cityCourseDressing(course, boxes, kit.facade), nightSky());
  return { scene, bounds };
}

/** Frees a course scene's geometry (materials are shared and freed by their owner). */
export function disposeCourseScene(scene: Scene): void {
  scene.traverse((o) => (o as Mesh).geometry?.dispose());
}

/** A picture of each course in the chosen look, as an image URL, by course id. */
export function renderCoursePreviews(courses: readonly CourseDefinition[], theme: Theme): Map<string, string> {
  const out = new Map<string, string>();
  const gl = previewRenderer(true);
  const kit = previewKit(theme);
  try {
    for (const course of courses) {
      const { scene, bounds } = buildCourseScene(course, kit);
      // Up behind the start and a little to the side, looking down the course to its middle, so
      // the course runs away into the distance and fills the frame.
      const centre = bounds.getCenter(new Vector3());
      const [sx, sy, sz] = course.start.pos;
      const start = new Vector3(sx, sy, sz);
      const back = new Vector3(Math.sin(course.start.yaw), 0, Math.cos(course.start.yaw));
      const right = new Vector3(back.z, 0, -back.x);
      const reach = start.distanceTo(centre);
      const camera = new PerspectiveCamera(50, PREVIEW_WIDTH / PREVIEW_HEIGHT, 1, 5000);
      camera.position.copy(start).addScaledVector(back, reach * 0.18).addScaledVector(right, reach * 0.12);
      camera.position.y += reach * 0.3;
      // Aim a little past the start toward the middle: the near course big, the rest beyond.
      camera.lookAt(start.clone().lerp(centre, 0.6));
      gl.render(scene, camera);
      out.set(course.id, gl.domElement.toDataURL('image/jpeg', 0.85));
      disposeCourseScene(scene);
    }
  } finally {
    disposeKit(kit);
    gl.dispose();
    gl.forceContextLoss();
  }
  return out;
}
