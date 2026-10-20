import { CatmullRomCurve3, type MeshStandardMaterial, PerspectiveCamera, type Scene, Vector3, type WebGLRenderer } from 'three';
import type { CourseDefinition } from '../course/types';
import type { SurfaceKind } from '../sim/collision';
import { PREVIEW_HEIGHT, PREVIEW_WIDTH, buildCourseScene, disposeCourseScene, previewRenderer } from './preview';

// The level picker's live preview: a camera flying a course from the start, through each
// checkpoint, to the finish, on a loop. One small renderer for all courses, kept only while the
// picker is open; its canvas is moved over whichever card is hovered.

/** One pass of a course, s. */
const FLY_SECONDS = 9;
/** How far above the path the camera flies, and how far ahead (as a share of the path) it looks, m. */
const HEIGHT = 7;
const LOOK_AHEAD = 0.07;

interface Flight {
  scene: Scene;
  path: CatmullRomCurve3;
}

export class FlyThrough {
  private readonly gl: WebGLRenderer = previewRenderer();
  private readonly camera = new PerspectiveCamera(60, PREVIEW_WIDTH / PREVIEW_HEIGHT, 0.5, 4000);
  private readonly materials = new Map<SurfaceKind, MeshStandardMaterial>();
  private readonly flights = new Map<string, Flight>();
  private readonly at = new Vector3();
  private readonly ahead = new Vector3();
  private readonly dir = new Vector3();
  private playing: Flight | null = null;
  private frame = 0;
  private started = 0;

  constructor(courses: readonly CourseDefinition[]) {
    this.gl.domElement.className = 'flythrough';
    for (const course of courses) {
      const { scene } = buildCourseScene(course, this.materials);
      const points = [course.start.pos, ...course.checkpoints.map((c) => c.respawn.pos), course.finish.center].map(
        ([x, y, z]) => new Vector3(x, y, z),
      );
      this.flights.set(course.id, { scene, path: new CatmullRomCurve3(points, false, 'centripetal') });
    }
  }

  /** Flies `courseId`, its canvas filling `host` (which should be positioned). */
  play(courseId: string, host: HTMLElement): void {
    const flight = this.flights.get(courseId);
    if (!flight) return;
    this.playing = flight;
    this.started = performance.now();
    host.append(this.gl.domElement);
    if (!this.frame) this.frame = requestAnimationFrame(this.tick);
  }

  stop(): void {
    this.playing = null;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.gl.domElement.remove();
  }

  dispose(): void {
    this.stop();
    for (const f of this.flights.values()) disposeCourseScene(f.scene);
    for (const m of this.materials.values()) m.dispose();
    this.gl.dispose();
    this.gl.forceContextLoss();
  }

  private readonly tick = (now: number): void => {
    const f = this.playing;
    if (!f) return;
    // Ease in and out of each pass, then start again.
    const t = (((now - this.started) / 1000) % FLY_SECONDS) / FLY_SECONDS;
    const u = 0.5 - 0.5 * Math.cos(Math.PI * t);
    f.path.getPointAt(u, this.at);
    const look = u + LOOK_AHEAD;
    if (look <= 1) f.path.getPointAt(look, this.ahead);
    else {
      // Past the finish: carry on the way the path ends, so the view never folds back on itself.
      f.path.getPointAt(1, this.ahead);
      this.ahead.addScaledVector(f.path.getTangentAt(1, this.dir), (look - 1) * f.path.getLength());
    }
    this.camera.position.copy(this.at);
    this.camera.position.y += HEIGHT;
    this.ahead.y += 1.5;
    this.camera.lookAt(this.ahead);
    this.gl.render(f.scene, this.camera);
    this.frame = requestAnimationFrame(this.tick);
  };
}
