import {
  ACESFilmicToneMapping,
  BoxGeometry,
  Box3,
  Color,
  DirectionalLight,
  EdgesGeometry,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  type MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import type { CourseDefinition } from '../course/types';
import { makeBox, type SurfaceKind } from '../sim/collision';
import { SURFACE_COLORS, gridMaterial } from './materials';
import { SPACE_COLOR } from './space';
import { finishGate } from './worldViews';

// Level previews for the level picker: each course drawn once, small, in a throwaway scene, seen
// from high up behind the start looking down the course. Saved as images, so the picker never
// keeps a second WebGL context alive.

const WIDTH = 480;
const HEIGHT = 270;

/** A picture of each course, as an image URL, by course id. */
export function renderCoursePreviews(courses: readonly CourseDefinition[]): Map<string, string> {
  const out = new Map<string, string>();
  const gl = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(WIDTH, HEIGHT, false);
  gl.outputColorSpace = SRGBColorSpace;
  gl.toneMapping = ACESFilmicToneMapping;
  const materials = new Map<SurfaceKind, MeshStandardMaterial>();
  try {
    for (const course of courses) {
      const scene = new Scene();
      scene.background = new Color(SPACE_COLOR);
      scene.add(new HemisphereLight('#a9b8ff', '#2a2050', 1.4));
      const sun = new DirectionalLight('#fff6e8', 2.6);
      sun.position.set(-0.45, 1, 0.35);
      scene.add(sun);
      const bounds = new Box3();
      for (const spec of course.pieces) {
        const box = makeBox(spec);
        let mat = materials.get(box.kind);
        if (!mat) materials.set(box.kind, (mat = gridMaterial(box.kind)));
        const geo = new BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2);
        const mesh = new Mesh(geo, mat);
        mesh.position.copy(box.center);
        mesh.quaternion.copy(box.rot);
        mesh.add(new LineSegments(new EdgesGeometry(geo), new LineBasicMaterial({ color: new Color(SURFACE_COLORS[box.kind].line).multiplyScalar(0.7) })));
        scene.add(mesh);
        bounds.expandByPoint(box.center);
      }
      scene.add(finishGate(course.finish));
      // Up behind the start and a little to the side, looking down the course to its middle, so
      // the course runs away into the distance and fills the frame.
      const centre = bounds.getCenter(new Vector3());
      const [sx, sy, sz] = course.start.pos;
      const start = new Vector3(sx, sy, sz);
      const back = new Vector3(Math.sin(course.start.yaw), 0, Math.cos(course.start.yaw));
      const right = new Vector3(back.z, 0, -back.x);
      const reach = start.distanceTo(centre);
      const camera = new PerspectiveCamera(50, WIDTH / HEIGHT, 1, 5000);
      camera.position.copy(start).addScaledVector(back, reach * 0.18).addScaledVector(right, reach * 0.12);
      camera.position.y += reach * 0.3;
      // Aim a little past the start toward the middle: the near course big, the rest beyond.
      camera.lookAt(start.clone().lerp(centre, 0.6));
      gl.render(scene, camera);
      out.set(course.id, gl.domElement.toDataURL('image/jpeg', 0.85));
      scene.traverse((o) => (o as Mesh).geometry?.dispose());
    }
  } finally {
    for (const m of materials.values()) m.dispose();
    gl.dispose();
    gl.forceContextLoss();
  }
  return out;
}
