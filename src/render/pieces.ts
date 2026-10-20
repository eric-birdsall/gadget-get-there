import {
  BoxGeometry,
  CanvasTexture,
  Color,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import { type Box, SurfaceKind } from '../sim/collision';
import { gridMaterial } from './materials';
import { THEMES, type Theme, type ThemeLook } from './theme';

// The course's pieces as meshes, one per box, for the game and the level previews alike. In the
// city the walls become city things: a thin wall is a lit billboard (an advert on each face, a
// steel frame round it), a thick one is brick. Look only: every piece keeps its box.

/** A wall at most this thick (half-thickness, m) is a billboard in the city. */
const BILLBOARD_HALF_THICKNESS = 0.6;

/** Brick for the city's thick walls: the brick colour and the mortar between. */
const CITY_BRICK = { base: '#7c4434', line: '#9c928a' };
const BILLBOARD_FRAME = '#2e323d';

/** Advert resolution, pixels per metre, and the largest side of an advert's canvas. */
const AD_PX_PER_M = 40;
const AD_MAX_PX = 1024;
/** How brightly the adverts glow, as if lit by their lamps. */
const AD_GLOW = 0.5;

/** In the city, is this piece drawn as a billboard? (Thin upright walls.) */
export function isBillboard(box: Box): boolean {
  return box.kind === SurfaceKind.Wall && Math.min(box.half.x, box.half.z) <= BILLBOARD_HALF_THICKNESS;
}

/** Builds the course's pieces in one look, sharing materials between pieces, and frees them together. */
export class PieceKit {
  private readonly look: ThemeLook;
  private readonly grid = new Map<SurfaceKind, MeshStandardMaterial>();
  private readonly edges = new Map<string, LineBasicMaterial>();
  private brick: MeshStandardMaterial | null = null;
  private frame: MeshStandardMaterial | null = null;
  /** Materials made for one piece only (each billboard's adverts). */
  private readonly own: Material[] = [];
  /** Adverts used so far: the next board takes the next two, so neighbours differ. */
  private adverts = 0;

  constructor(readonly theme: Theme) {
    this.look = THEMES[theme];
  }

  /** The piece's box mesh with its outline, placed where the box is. */
  mesh(box: Box): Mesh {
    const geo = new BoxGeometry(box.half.x * 2, box.half.y * 2, box.half.z * 2);
    const mesh = new Mesh(geo, this.materialFor(box));
    mesh.position.copy(box.center);
    mesh.quaternion.copy(box.rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.add(new LineSegments(new EdgesGeometry(geo), this.edgeFor(box.kind)));
    return mesh;
  }

  dispose(): void {
    for (const m of [...this.grid.values(), ...this.edges.values(), ...this.own]) m.dispose();
    this.brick?.dispose();
    this.frame?.dispose();
  }

  private materialFor(box: Box): Material | Material[] {
    if (this.theme === 'city' && box.kind === SurfaceKind.Wall) {
      if (isBillboard(box)) return this.billboard(box);
      return (this.brick ??= gridMaterial(box.kind, this.look, CITY_BRICK, true));
    }
    let mat = this.grid.get(box.kind);
    if (!mat) this.grid.set(box.kind, (mat = gridMaterial(box.kind, this.look)));
    return mat;
  }

  private edgeFor(kind: SurfaceKind): LineBasicMaterial {
    const s = this.look.surfaces[kind];
    const color = s.edge ? new Color(s.edge) : new Color(s.line).multiplyScalar(this.look.edgeBrightness);
    const key = color.getHexString();
    let mat = this.edges.get(key);
    if (!mat) this.edges.set(key, (mat = new LineBasicMaterial({ color })));
    return mat;
  }

  /**
   * Six face materials (the box's +x, −x, +y, −y, +z, −z): an advert on each broad face, a
   * different one on the back, and steel on the thin edges.
   */
  private billboard(box: Box): Material[] {
    this.frame ??= new MeshStandardMaterial({ color: BILLBOARD_FRAME, roughness: 0.5, metalness: 0.5 });
    const thinX = box.half.x <= box.half.z;
    const width = 2 * (thinX ? box.half.z : box.half.x);
    const height = 2 * box.half.y;
    const ad = (n: number) => {
      const map = advert(ADVERTS[n % ADVERTS.length], width, height);
      const m = new MeshStandardMaterial({ map, emissiveMap: map, emissive: '#ffffff', emissiveIntensity: AD_GLOW, roughness: 0.6 });
      this.own.push(m);
      return m;
    };
    const front = ad(this.adverts++);
    const back = ad(this.adverts++);
    const f = this.frame;
    return thinX ? [front, back, f, f, f, f] : [f, f, f, f, front, back];
  }
}

/** Draws an advert's picture into the square at (x, y), side s. */
type Icon = (g: CanvasRenderingContext2D, x: number, y: number, s: number) => void;

interface Advert {
  /** Background, top to bottom. */
  sky: [string, string];
  title: string;
  tagline: string;
  ink: string;
  icon: Icon;
}

// Made-up adverts for made-up shops: nothing real is advertised.
const ADVERTS: Advert[] = [
  {
    sky: ['#d8402f', '#8e1f1a'],
    title: 'NOODLE HOUSE',
    tagline: 'open late',
    ink: '#fff4e0',
    icon: (g, x, y, s) => {
      // A bowl with steam rising.
      g.fillStyle = '#fff4e0';
      g.beginPath();
      g.arc(x + s / 2, y + s * 0.55, s * 0.38, 0, Math.PI);
      g.fill();
      g.fillRect(x + s * 0.12, y + s * 0.5, s * 0.76, s * 0.06);
      g.strokeStyle = '#fff4e0';
      g.lineWidth = s * 0.04;
      for (const dx of [0.36, 0.5, 0.64]) {
        g.beginPath();
        g.moveTo(x + s * dx, y + s * 0.44);
        g.bezierCurveTo(x + s * (dx - 0.06), y + s * 0.32, x + s * (dx + 0.06), y + s * 0.24, x + s * dx, y + s * 0.12);
        g.stroke();
      }
    },
  },
  {
    sky: ['#2f8fe0', '#123a7a'],
    title: 'FIZZ',
    tagline: 'ice cold soda',
    ink: '#ffffff',
    icon: (g, x, y, s) => {
      // A bottle and bubbles.
      g.fillStyle = '#e8f6ff';
      g.fillRect(x + s * 0.42, y + s * 0.08, s * 0.16, s * 0.18);
      g.beginPath();
      g.moveTo(x + s * 0.42, y + s * 0.26);
      g.lineTo(x + s * 0.3, y + s * 0.4);
      g.lineTo(x + s * 0.3, y + s * 0.92);
      g.lineTo(x + s * 0.7, y + s * 0.92);
      g.lineTo(x + s * 0.7, y + s * 0.4);
      g.lineTo(x + s * 0.58, y + s * 0.26);
      g.fill();
      g.fillStyle = '#e8473a';
      g.fillRect(x + s * 0.3, y + s * 0.55, s * 0.4, s * 0.16);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      for (const [bx, by, r] of [[0.15, 0.3, 0.05], [0.82, 0.2, 0.04], [0.85, 0.6, 0.06], [0.12, 0.7, 0.035]]) {
        g.beginPath();
        g.arc(x + s * bx, y + s * by, s * r, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  {
    sky: ['#2a7a70', '#123c38'],
    title: 'RIDE THE METRO',
    tagline: 'every five minutes',
    ink: '#ffffff',
    icon: (g, x, y, s) => {
      // A round station sign with an M.
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x + s / 2, y + s / 2, s * 0.42, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#2a7a70';
      g.font = `900 ${Math.round(s * 0.5)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('M', x + s / 2, y + s * 0.53);
    },
  },
  {
    sky: ['#f39a2c', '#b8550f'],
    title: 'PIZZA',
    tagline: 'hot and fresh',
    ink: '#fffbe8',
    icon: (g, x, y, s) => {
      // A slice: crust along the top, pepperoni on the cheese.
      g.fillStyle = '#ffd65a';
      g.beginPath();
      g.moveTo(x + s * 0.12, y + s * 0.2);
      g.lineTo(x + s * 0.88, y + s * 0.2);
      g.lineTo(x + s * 0.5, y + s * 0.92);
      g.fill();
      g.fillStyle = '#c9822f';
      g.fillRect(x + s * 0.1, y + s * 0.12, s * 0.8, s * 0.1);
      g.fillStyle = '#c0392b';
      for (const [px, py] of [[0.38, 0.35], [0.6, 0.38], [0.5, 0.58]]) {
        g.beginPath();
        g.arc(x + s * px, y + s * py, s * 0.07, 0, Math.PI * 2);
        g.fill();
      }
    },
  },
  {
    sky: ['#5b3a96', '#24144a'],
    title: 'RADIO 98',
    tagline: 'city hits all night',
    ink: '#ffe27a',
    icon: (g, x, y, s) => {
      // A mast sending out waves.
      g.strokeStyle = '#ffe27a';
      g.fillStyle = '#ffe27a';
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(x + s * 0.5, y + s * 0.35);
      g.lineTo(x + s * 0.32, y + s * 0.92);
      g.moveTo(x + s * 0.5, y + s * 0.35);
      g.lineTo(x + s * 0.68, y + s * 0.92);
      g.stroke();
      g.beginPath();
      g.arc(x + s * 0.5, y + s * 0.3, s * 0.06, 0, Math.PI * 2);
      g.fill();
      for (const r of [0.16, 0.28]) {
        for (const side of [-1, 1]) {
          g.beginPath();
          g.arc(x + s * 0.5, y + s * 0.3, s * r, side > 0 ? -0.7 : Math.PI - 0.7, side > 0 ? 0.7 : Math.PI + 0.7);
          g.stroke();
        }
      }
    },
  },
  {
    sky: ['#6e4630', '#33200f'],
    title: 'CORNER COFFEE',
    tagline: 'fresh every morning',
    ink: '#f6e6cf',
    icon: (g, x, y, s) => {
      // A cup and saucer with steam.
      g.fillStyle = '#f6e6cf';
      g.fillRect(x + s * 0.24, y + s * 0.4, s * 0.42, s * 0.36);
      g.fillRect(x + s * 0.14, y + s * 0.78, s * 0.62, s * 0.06);
      g.strokeStyle = '#f6e6cf';
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.arc(x + s * 0.7, y + s * 0.56, s * 0.1, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.lineWidth = s * 0.035;
      for (const dx of [0.36, 0.52]) {
        g.beginPath();
        g.moveTo(x + s * dx, y + s * 0.34);
        g.bezierCurveTo(x + s * (dx - 0.05), y + s * 0.26, x + s * (dx + 0.05), y + s * 0.2, x + s * dx, y + s * 0.1);
        g.stroke();
      }
    },
  },
];

/** Adverts already drawn, by design and size: boards of one size share a picture. */
const advertCache = new Map<string, CanvasTexture>();

/** An advert drawn to fit a board `width` × `height` m: picture and words side by side, or stacked on a tall board. */
function advert(ad: Advert, width: number, height: number): CanvasTexture {
  const scale = Math.min(AD_PX_PER_M, AD_MAX_PX / Math.max(width, height));
  const w = Math.max(64, Math.round(width * scale));
  const h = Math.max(64, Math.round(height * scale));
  const key = `${ad.title}:${w}x${h}`;
  const cached = advertCache.get(key);
  if (cached) return cached;

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, ad.sky[0]);
  bg.addColorStop(1, ad.sky[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  const pad = Math.min(w, h) * 0.08;
  const wide = w / h >= 1.5;
  // The picture takes at most a third of a wide board, so the words stay big.
  const iconSide = wide ? Math.min(h - pad * 2, w * 0.3) : Math.min(w - pad * 2, h * 0.5);
  if (wide) {
    ad.icon(g, pad, (h - iconSide) / 2, iconSide);
    words(g, ad, pad * 2 + iconSide, pad, w - iconSide - pad * 3, h - pad * 2);
  } else {
    ad.icon(g, (w - iconSide) / 2, pad, iconSide);
    words(g, ad, pad, pad * 2 + iconSide, w - pad * 2, h - iconSide - pad * 3);
  }

  // Lamplight washing down from the top, the bottom in shadow.
  const light = g.createLinearGradient(0, 0, 0, h);
  light.addColorStop(0, 'rgba(255, 244, 220, 0.28)');
  light.addColorStop(0.45, 'rgba(255, 244, 220, 0)');
  light.addColorStop(1, 'rgba(0, 0, 0, 0.3)');
  g.fillStyle = light;
  g.fillRect(0, 0, w, h);
  // The seams between the printed panels.
  g.fillStyle = 'rgba(0, 0, 0, 0.12)';
  const panel = Math.max(48, Math.round(3 * scale));
  for (let x = panel; x < w; x += panel) g.fillRect(x, 0, Math.max(1, scale * 0.04), h);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  advertCache.set(key, tex);
  return tex;
}

/** The title, as big as fits, with the tagline under it, centred in the box at (x, y). */
function words(g: CanvasRenderingContext2D, ad: Advert, x: number, y: number, w: number, h: number): void {
  const font = (weight: number, size: number) => `${weight} ${Math.round(size)}px system-ui, sans-serif`;
  // The largest size up to maxH at which the text fits the width.
  const fit = (text: string, weight: number, maxH: number) => {
    g.font = font(weight, maxH);
    return maxH * Math.min(1, w / g.measureText(text).width);
  };
  const titleSize = fit(ad.title, 900, h * 0.5);
  const tagSize = fit(ad.tagline, 600, Math.min(h * 0.22, titleSize * 0.5));
  const top = y + (h - titleSize - tagSize * 1.4) / 2;
  g.fillStyle = ad.ink;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(900, titleSize);
  g.fillText(ad.title, x + w / 2, top + titleSize / 2);
  g.font = font(600, tagSize);
  g.fillText(ad.tagline, x + w / 2, top + titleSize + tagSize * 0.9);
}
