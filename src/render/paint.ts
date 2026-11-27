// Everything on the board is drawn here in code: birch plywood with holes, beech ramps with grain and a routed groove,
// enamel chime bars with steel rivets, cast brass bells, clear glass marbles. Pieces are drawn once into sprites at
// the current scale (back layer, front layer, shadow) and then placed each frame.

import {
  BOARD, COLS, ROWS, CUP_Y, NOTES, TRAY, bellGeo, chimeGeo, rampGeo, type Piece,
} from '../board/board.ts';

export const ENAMEL = ['#d92b2b', '#f26a1b', '#f6c514', '#2f9e3e', '#17ada4', '#2559cf', '#7b3db3', '#ee6b9b'];
export const BLUE = '#2f6fd0';
export const YELLOW = '#ffd23f';

// ------------------------------------------------------------------ small helpers

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

function mix(hex: string, to: string, t: number): string {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) * (1 - t) + ((b >> sh) & 255) * t);
  return `rgb(${ch(16)},${ch(8)},${ch(0)})`;
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Long-grain wood texture: wavy grain lines, darker figure and the small ray flecks beech is known for. */
function grainTexture(seed: number, base: string, dark: string, light: string, flecks: boolean, calm = 1): HTMLCanvasElement {
  const W = 1024, H = 256;
  const c = canvas(W, H), g = c.getContext('2d')!;
  const R = rng(seed);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  // Broad soft bands.
  for (let i = 0; i < 9; i++) {
    const y = R() * H, h = 20 + R() * 60;
    const gr = g.createLinearGradient(0, y - h, 0, y + h);
    const col = R() < 0.5 ? light : dark;
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.5, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.12 + R() * 0.12;
    g.fillStyle = gr; g.fillRect(0, y - h, W, h * 2);
  }
  g.globalAlpha = 1;
  // Grain lines.
  for (let i = 0; i < 70; i++) {
    const y0 = R() * H, amp = (2 + R() * 7) * calm, f = (0.002 + R() * 0.006) * Math.PI * 2 * (calm < 1 ? 0.5 : 1), ph = R() * 6.28;
    const amp2 = R() * 3 * calm, f2 = f * (2 + R() * 3);
    g.beginPath();
    for (let x = -10; x <= W + 10; x += 8) {
      const y = y0 + Math.sin(x * f + ph) * amp + Math.sin(x * f2 + ph * 2) * amp2;
      if (x === -10) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.strokeStyle = dark;
    g.globalAlpha = (0.05 + R() * 0.16) * (calm < 1 ? 0.55 : 1);
    g.lineWidth = 0.6 + R() * 1.8;
    g.stroke();
  }
  if (flecks) {
    g.fillStyle = dark;
    for (let i = 0; i < 520; i++) {
      g.globalAlpha = 0.08 + R() * 0.16;
      const x = R() * W, y = R() * H, l = 1.5 + R() * 4;
      g.beginPath(); g.ellipse(x, y, l, 0.7 + R() * 0.5, 0, 0, Math.PI * 2); g.fill();
    }
  }
  g.globalAlpha = 1;
  return c;
}

/** Fill the current path with a wood texture laid along the local x axis. */
function fillWood(ctx: CanvasRenderingContext2D, tex: HTMLCanvasElement, x: number, y: number, w: number, h: number, sx: number, sy: number): void {
  ctx.save();
  ctx.clip();
  // A slice of the texture, picked by (sx, sy) so pieces do not all look identical.
  const tw = Math.min(tex.width, 1024 * Math.min(1, w / 7)), th = Math.min(tex.height, 64 + h * 60);
  const ox = sx * (tex.width - tw), oy = sy * (tex.height - th);
  ctx.drawImage(tex, ox, oy, tw, th, x, y, w, h);
  ctx.restore();
}

// ------------------------------------------------------------------ sprites

export interface Sprite {
  /** Canvas in device pixels; drawn with its top-left at (x0, y0) in world units relative to the anchor. */
  img: HTMLCanvasElement;
  x0: number; y0: number; w: number; h: number;
}

export interface PieceSprites { back: Sprite; front: Sprite | null; shadow: Sprite; }

function sprite(scale: number, x0: number, y0: number, x1: number, y1: number, draw: (g: CanvasRenderingContext2D) => void): Sprite {
  const w = x1 - x0, h = y1 - y0;
  const img = canvas(w * scale, h * scale);
  const g = img.getContext('2d')!;
  g.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
  g.lineJoin = 'round'; g.lineCap = 'round';
  draw(g);
  return { img, x0, y0, w, h };
}

/** A soft drop shadow from a silhouette. */
function shadowOf(scale: number, x0: number, y0: number, x1: number, y1: number, draw: (g: CanvasRenderingContext2D) => void, blur = 0.09, alpha = 0.32): Sprite {
  const pad = blur * 3;
  const sil = sprite(scale, x0 - pad, y0 - pad, x1 + pad, y1 + pad, (g) => { g.fillStyle = '#000'; draw(g); });
  const out = canvas(sil.img.width, sil.img.height);
  const g = out.getContext('2d')!;
  const far = out.width + 50;
  g.shadowColor = `rgba(70,40,12,${alpha})`;
  g.shadowBlur = blur * scale;
  g.shadowOffsetX = far;
  g.drawImage(sil.img, -far, 0);
  return { img: out, x0: sil.x0, y0: sil.y0, w: sil.w, h: sil.h };
}

export class Painter {
  /** Device pixels per pitch for sprites. */
  scale = 1;
  private beech!: HTMLCanvasElement;
  private beechDark!: HTMLCanvasElement;
  private birch!: HTMLCanvasElement;
  private cache = new Map<string, PieceSprites>();
  board: HTMLCanvasElement | null = null;
  boardFront: Sprite | null = null;
  cupBack: Sprite | null = null;
  cupFront: Sprite | null = null;
  marble: Sprite | null = null;
  marbleShadow: Sprite | null = null;
  private texReady = false;

  setScale(scale: number): void {
    if (!this.texReady) {
      this.beech = grainTexture(11, '#e3b684', '#b77d4a', '#f2d1a6', true);
      this.beechDark = grainTexture(23, '#c99461', '#8f5a2c', '#dcae7b', true);
      this.birch = grainTexture(37, '#f0dbb5', '#d4b386', '#f9ebd0', false, 0.35);
      this.texReady = true;
    }
    if (Math.abs(scale - this.scale) < 0.01 && this.board) return;
    this.scale = scale;
    this.cache.clear();
    this.uprightCache.clear();
    this.buildBoard();
    this.buildCup();
    this.buildMarble();
  }

  // ---------------------------------------------------------------- board

  private buildBoard(): void {
    const S = this.scale;
    const pad = 0.9;
    const x0 = BOARD.x0 - pad, y0 = BOARD.y0 - pad, x1 = BOARD.x1 + pad, y1 = BOARD.y1 + pad + 0.3;
    const sp = sprite(S, x0, y0, x1, y1, (g) => {
      const bw = BOARD.x1 - BOARD.x0, bh = BOARD.y1 - BOARD.y0;
      // Shadow on the wall.
      g.save();
      g.shadowColor = 'rgba(8,22,70,0.42)';
      g.shadowBlur = 0.55 * S;
      g.shadowOffsetX = 0.18 * S; g.shadowOffsetY = 0.38 * S;
      rrect(g, BOARD.x0, BOARD.y0, bw, bh + 0.14, 0.34);
      g.fillStyle = '#b48a58'; g.fill();
      g.restore();
      // Plywood edge (the board's thickness, seen along the bottom).
      rrect(g, BOARD.x0, BOARD.y0 + 0.14, bw, bh, 0.34);
      g.fillStyle = '#c9a26f'; g.fill();
      g.save(); g.clip();
      for (let k = 0; k < 4; k++) {
        g.fillStyle = k % 2 ? 'rgba(120,80,40,0.28)' : 'rgba(255,240,210,0.25)';
        g.fillRect(BOARD.x0, BOARD.y1 + 0.02 + k * 0.03, bw, 0.016);
      }
      g.restore();
      // Face.
      rrect(g, BOARD.x0, BOARD.y0, bw, bh, 0.34);
      fillWood(g, this.birch, BOARD.x0, BOARD.y0, bw, bh, 0.1, 0.2);
      // Gentle light from the top left.
      rrect(g, BOARD.x0, BOARD.y0, bw, bh, 0.34);
      const lg = g.createLinearGradient(BOARD.x0, BOARD.y0, BOARD.x1, BOARD.y1);
      lg.addColorStop(0, 'rgba(255,250,235,0.22)'); lg.addColorStop(0.6, 'rgba(255,250,235,0)'); lg.addColorStop(1, 'rgba(120,80,40,0.10)');
      g.fillStyle = lg; g.fill();
      // Sanded edge highlight.
      rrect(g, BOARD.x0 + 0.03, BOARD.y0 + 0.03, bw - 0.06, bh - 0.06, 0.31);
      g.strokeStyle = 'rgba(255,248,230,0.55)'; g.lineWidth = 0.035; g.stroke();
      // Holes.
      for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) this.hole(g, c, r);
      // Corner screws.
      const sx = [BOARD.x0 + 0.32, BOARD.x1 - 0.32], sy = [BOARD.y0 + 0.32, BOARD.y1 - 0.32];
      for (const x of sx) for (const y of sy) this.screw(g, x, y);
      // Catch tray, back half: the inside of the box.
      const t = TRAY;
      rrect(g, t.x0 - 0.2, t.top - 0.05, t.x1 - t.x0 + 0.4, 1.0, 0.12);
      g.fillStyle = '#a8743f'; g.fill();
      rrect(g, t.x0 - 0.2, t.top - 0.05, t.x1 - t.x0 + 0.4, 1.0, 0.12);
      fillWood(g, this.beechDark, t.x0 - 0.2, t.top - 0.05, t.x1 - t.x0 + 0.4, 1.0, 0.4, 0.6);
      const ig = g.createLinearGradient(0, t.top - 0.05, 0, t.top + 0.95);
      ig.addColorStop(0, 'rgba(255,230,190,0.35)'); ig.addColorStop(0.25, 'rgba(60,30,10,0.0)'); ig.addColorStop(1, 'rgba(60,30,10,0.35)');
      rrect(g, t.x0 - 0.2, t.top - 0.05, t.x1 - t.x0 + 0.4, 1.0, 0.12);
      g.fillStyle = ig; g.fill();
    });
    this.board = sp.img;
    this.boardOrigin = [x0, y0];
    // Tray front, drawn over the marbles.
    const t = TRAY;
    const fx0 = t.x0 - 0.26, fx1 = t.x1 + 0.26, fy0 = 13.72, fy1 = 14.66;
    this.boardFront = sprite(S, fx0 - 0.3, fy0 - 0.3, fx1 + 0.3, fy1 + 0.3, (g) => {
      g.save();
      g.shadowColor = 'rgba(70,40,12,0.35)'; g.shadowBlur = 0.12 * S; g.shadowOffsetY = 0.08 * S;
      rrect(g, fx0, fy0, fx1 - fx0, fy1 - fy0, 0.14);
      g.fillStyle = '#d9a873'; g.fill();
      g.restore();
      rrect(g, fx0, fy0, fx1 - fx0, fy1 - fy0, 0.14);
      fillWood(g, this.beech, fx0, fy0, fx1 - fx0, fy1 - fy0, 0.7, 0.3);
      rrect(g, fx0, fy0, fx1 - fx0, fy1 - fy0, 0.14);
      const lg = g.createLinearGradient(0, fy0, 0, fy1);
      lg.addColorStop(0, 'rgba(255,245,225,0.75)'); lg.addColorStop(0.07, 'rgba(255,245,225,0.15)');
      lg.addColorStop(0.75, 'rgba(90,50,20,0.0)'); lg.addColorStop(1, 'rgba(90,50,20,0.22)');
      g.fillStyle = lg; g.fill();
      // The maker's mark, pressed into the wood.
      g.font = `700 ${0.3}px "Bricolage Grotesque Variable", sans-serif`;
      g.textAlign = 'right'; g.textBaseline = 'middle';
      g.fillStyle = 'rgba(255,240,215,0.5)';
      g.fillText('Tumblewood', fx1 - 0.42, (fy0 + fy1) / 2 + 0.07 + 0.018);
      g.fillStyle = 'rgba(105,60,25,0.55)';
      g.fillText('Tumblewood', fx1 - 0.42, (fy0 + fy1) / 2 + 0.07);
    });
  }

  boardOrigin: [number, number] = [0, 0];

  private hole(g: CanvasRenderingContext2D, x: number, y: number): void {
    const r = 0.082;
    g.beginPath(); g.arc(x, y + 0.012, r + 0.014, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,248,232,0.7)'; g.fill();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    const hg = g.createRadialGradient(x, y - r * 0.55, r * 0.1, x, y, r);
    hg.addColorStop(0, '#3a2716'); hg.addColorStop(0.7, '#5a3e24'); hg.addColorStop(1, '#a07a50');
    g.fillStyle = hg; g.fill();
  }

  private screw(g: CanvasRenderingContext2D, x: number, y: number): void {
    g.beginPath(); g.arc(x + 0.015, y + 0.025, 0.1, 0, Math.PI * 2); g.fillStyle = 'rgba(80,50,20,0.3)'; g.fill();
    g.beginPath(); g.arc(x, y, 0.09, 0, Math.PI * 2);
    const sg = g.createRadialGradient(x - 0.03, y - 0.04, 0.01, x, y, 0.09);
    sg.addColorStop(0, '#ffffff'); sg.addColorStop(0.5, '#c4c8cc'); sg.addColorStop(1, '#73787d');
    g.fillStyle = sg; g.fill();
    g.save(); g.translate(x, y); g.rotate(0.6 + x * 3);
    g.fillStyle = 'rgba(60,64,70,0.75)'; g.fillRect(-0.06, -0.012, 0.12, 0.024);
    g.restore();
  }

  /** A wooden dowel peg seen end on. */
  peg(g: CanvasRenderingContext2D, x: number, y: number, r = 0.17): void {
    g.beginPath(); g.arc(x + 0.025, y + 0.04, r, 0, Math.PI * 2); g.fillStyle = 'rgba(80,45,15,0.28)'; g.fill();
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
    const pg = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    pg.addColorStop(0, '#f3d4a8'); pg.addColorStop(0.7, '#d9a771'); pg.addColorStop(1, '#a8723f');
    g.fillStyle = pg; g.fill();
    g.strokeStyle = 'rgba(140,90,45,0.35)'; g.lineWidth = 0.012;
    for (const k of [0.35, 0.62]) { g.beginPath(); g.arc(x + 0.01, y + 0.01, r * k, 0, Math.PI * 2); g.stroke(); }
  }

  // ---------------------------------------------------------------- cup and marble

  private buildCup(): void {
    const S = this.scale;
    // Interior and the marble waiting in it.
    this.cupBack = sprite(S, -0.7, CUP_Y - 0.7, 0.7, CUP_Y + 0.6, (g) => {
      const y = CUP_Y;
      g.save();
      g.shadowColor = 'rgba(70,40,12,0.3)'; g.shadowBlur = 0.1 * S; g.shadowOffsetX = 0.05 * S; g.shadowOffsetY = 0.09 * S;
      g.beginPath(); g.ellipse(0, y - 0.32, 0.46, 0.13, 0, 0, Math.PI * 2); g.fillStyle = '#7b4f28'; g.fill();
      g.restore();
      g.beginPath(); g.ellipse(0, y - 0.32, 0.4, 0.1, 0, 0, Math.PI * 2);
      const ig = g.createLinearGradient(0, y - 0.42, 0, y - 0.22);
      ig.addColorStop(0, '#3e2611'); ig.addColorStop(1, '#8a5a30');
      g.fillStyle = ig; g.fill();
    });
    this.cupFront = sprite(S, -0.75, CUP_Y - 0.75, 0.75, CUP_Y + 0.65, (g) => {
      const y = CUP_Y;
      const path = () => {
        g.beginPath();
        g.moveTo(-0.46, y - 0.32);
        g.bezierCurveTo(-0.46, y + 0.02, -0.3, y + 0.22, -0.16, y + 0.3);
        g.lineTo(0.16, y + 0.3);
        g.bezierCurveTo(0.3, y + 0.22, 0.46, y + 0.02, 0.46, y - 0.32);
        g.ellipse(0, y - 0.32, 0.46, 0.13, 0, 0, Math.PI, false);
        g.closePath();
      };
      g.save();
      g.shadowColor = 'rgba(70,40,12,0.3)'; g.shadowBlur = 0.12 * S; g.shadowOffsetX = 0.05 * S; g.shadowOffsetY = 0.1 * S;
      path(); g.fillStyle = '#d6a26c'; g.fill();
      g.restore();
      path();
      g.save(); g.rotate(Math.PI / 2);
      fillWood(g, this.beech, y - 0.5, -0.5, 0.85, 1, 0.3, 0.5);
      g.restore();
      path();
      const sh = g.createLinearGradient(-0.46, 0, 0.46, 0);
      sh.addColorStop(0, 'rgba(90,50,20,0.35)'); sh.addColorStop(0.3, 'rgba(255,245,225,0.35)');
      sh.addColorStop(0.55, 'rgba(255,245,225,0)'); sh.addColorStop(1, 'rgba(90,50,20,0.4)');
      g.fillStyle = sh; g.fill();
      // Turned rings.
      g.strokeStyle = 'rgba(120,70,30,0.35)'; g.lineWidth = 0.018;
      for (const k of [0.02, 0.16]) { g.beginPath(); g.ellipse(0, y + k, 0.4 - k * 0.5, 0.06, 0, 0.15, Math.PI - 0.15); g.stroke(); }
      // Rim highlight.
      g.beginPath(); g.ellipse(0, y - 0.32, 0.46, 0.13, 0, 0.1, Math.PI - 0.1);
      g.strokeStyle = 'rgba(255,240,215,0.85)'; g.lineWidth = 0.035; g.stroke();
    });
  }

  private buildMarble(): void {
    const S = this.scale, r = 0.3;
    this.marble = sprite(S, -r - 0.02, -r - 0.02, r + 0.02, r + 0.02, (g) => drawGlass(g, r));
    this.marbleShadow = shadowOf(S, -r, -r, r, r, (g) => { g.beginPath(); g.arc(0, 0, r * 0.92, 0, Math.PI * 2); g.fill(); }, 0.07, 0.3);
  }

  // ---------------------------------------------------------------- pieces

  sprites(p: Piece): PieceSprites {
    const key = p.kind === 'ramp' ? `r${+p.flip}` : p.kind === 'chime' ? `c${p.note}${+p.flip}` : 'b';
    let s = this.cache.get(key);
    if (!s) {
      s = p.kind === 'ramp' ? this.rampSprites(p.flip) : p.kind === 'chime' ? this.chimeSprites(p.note, p.flip) : this.bellSprites();
      this.cache.set(key, s);
    }
    return s;
  }

  private rampSprites(flip: boolean): PieceSprites {
    const S = this.scale;
    const g0 = rampGeo(0, 0, flip);
    const L = flip ? [g0.ex, g0.ey] : [g0.hx, g0.hy];
    const R = flip ? [g0.hx, g0.hy] : [g0.ex, g0.ey];
    const len = Math.hypot(R[0] - L[0], R[1] - L[1]);
    const ang = Math.atan2(R[1] - L[1], R[0] - L[0]);
    const highLeft = !flip;
    const x0 = Math.min(L[0], R[0]) - 0.6, x1 = Math.max(L[0], R[0]) + 0.6;
    const y0 = Math.min(L[1], R[1]) - 1.3, y1 = Math.max(L[1], R[1]) + 0.8;
    const slotA = Math.hypot(g0.slotX - L[0], g0.slotY - L[1]);
    const local = (g: CanvasRenderingContext2D) => { g.translate(L[0], L[1]); g.rotate(ang); };
    const blockW = 0.3;
    const silhouette = (g: CanvasRenderingContext2D) => {
      g.save(); local(g);
      rrect(g, 0, -0.52, len, 0.72, 0.09); g.fill();
      rrect(g, highLeft ? 0 : len - blockW, -1.0, blockW, 1.2, 0.08); g.fill();
      rrect(g, highLeft ? len - blockW + 0.02 : 0, -0.86, blockW - 0.02, 1.06, 0.08); g.fill();
      g.restore();
      for (const [px, py] of g0.pegs) { g.beginPath(); g.arc(px, py, 0.17, 0, Math.PI * 2); g.fill(); }
    };
    const back = sprite(S, x0, y0, x1, y1, (g) => {
      for (const [px, py] of g0.pegs) this.peg(g, px, py);
      g.save(); local(g);
      // Back rim and the routed groove.
      rrect(g, 0.04, -0.54, len - 0.08, 0.3, 0.1);
      fillWood(g, this.beech, 0, -0.56, len, 0.34, flip ? 0.2 : 0.6, 0.1);
      rrect(g, 0.04, -0.54, len - 0.08, 0.3, 0.1);
      g.fillStyle = 'rgba(255,240,210,0.25)'; g.fill();
      rrect(g, 0.16, -0.47, len - 0.32, 0.2, 0.1);
      const gg = g.createLinearGradient(0, -0.47, 0, -0.27);
      gg.addColorStop(0, '#9c6535'); gg.addColorStop(0.55, '#c08a55'); gg.addColorStop(1, '#d8a875');
      g.fillStyle = gg; g.fill();
      // The drop slot: a hole right through the groove.
      g.beginPath(); g.ellipse(slotA, -0.37, 0.39, 0.085, 0, 0, Math.PI * 2);
      g.fillStyle = '#2a190c'; g.fill();
      g.beginPath(); g.ellipse(slotA, -0.35, 0.39, 0.075, 0, 0.1, Math.PI - 0.1);
      g.strokeStyle = 'rgba(255,230,190,0.5)'; g.lineWidth = 0.02; g.stroke();
      g.restore();
    });
    const front = sprite(S, x0, y0, x1, y1, (g) => {
      g.save(); local(g);
      // Front face of the ramp body.
      rrect(g, 0, -0.33, len, 0.53, 0.09);
      fillWood(g, this.beech, 0, -0.33, len, 0.53, flip ? 0.55 : 0.15, 0.4);
      rrect(g, 0, -0.33, len, 0.53, 0.09);
      const fg = g.createLinearGradient(0, -0.33, 0, 0.2);
      fg.addColorStop(0, 'rgba(255,248,232,0.85)'); fg.addColorStop(0.1, 'rgba(255,248,232,0.25)'); fg.addColorStop(0.2, 'rgba(255,248,232,0)');
      fg.addColorStop(0.8, 'rgba(100,55,20,0.05)'); fg.addColorStop(1, 'rgba(100,55,20,0.28)');
      g.fillStyle = fg; g.fill();
      // End blocks: the tall back stop and the shorter stop past the slot.
      const block = (bx: number, top: number, seedX: number) => {
        rrect(g, bx, top, blockW, 0.2 - top, 0.08);
        g.save();
        g.shadowColor = 'rgba(70,40,12,0.25)'; g.shadowBlur = 0.06 * S; g.shadowOffsetX = (bx < len / 2 ? 0.03 : -0.03) * S;
        g.fillStyle = '#ddb07c'; g.fill();
        g.restore();
        rrect(g, bx, top, blockW, 0.2 - top, 0.08);
        g.save(); g.rotate(0); fillWood(g, this.beech, bx, top, blockW, 0.2 - top, seedX, 0.8); g.restore();
        rrect(g, bx, top, blockW, 0.2 - top, 0.08);
        const bg = g.createLinearGradient(bx, 0, bx + blockW, 0);
        bg.addColorStop(0, 'rgba(255,248,232,0.45)'); bg.addColorStop(0.35, 'rgba(255,248,232,0)'); bg.addColorStop(1, 'rgba(100,55,20,0.22)');
        g.fillStyle = bg; g.fill();
        g.beginPath(); g.moveTo(bx + 0.07, top + 0.02); g.lineTo(bx + blockW - 0.07, top + 0.02);
        g.strokeStyle = 'rgba(255,250,236,0.8)'; g.lineWidth = 0.03; g.stroke();
      };
      block(highLeft ? 0 : len - blockW, -1.0, 0.3);
      block(highLeft ? len - blockW + 0.02 : 0, -0.86, 0.7);
      g.restore();
    });
    const shadow = shadowOf(S, x0, y0, x1, y1, silhouette);
    return { back, front, shadow };
  }

  private chimeSprites(note: number, flip: boolean): PieceSprites {
    const S = this.scale;
    const c = chimeGeo(0, 0, flip, note);
    const col = ENAMEL[note];
    const ext = c.len / 2 + 0.3;
    const bar = (g: CanvasRenderingContext2D) => { g.translate(c.ax, c.ay); g.rotate(c.angle); };
    const back = sprite(S, -ext, -ext * 0.5 - 0.3, ext, ext * 0.5 + 0.3, (g) => {
      this.peg(g, 0, 0, 0.15);
      g.save(); bar(g);
      drawBar(g, c.len, col);
      g.restore();
    });
    const shadow = shadowOf(S, -ext, -ext * 0.5 - 0.3, ext, ext * 0.5 + 0.3, (g) => {
      g.beginPath(); g.arc(0, 0, 0.15, 0, Math.PI * 2); g.fill();
      g.save(); bar(g); rrect(g, 0, -BAR_H / 2, c.len, BAR_H, 0.1); g.fill(); g.restore();
    });
    return { back, front: null, shadow };
  }

  private bellSprites(): PieceSprites {
    const S = this.scale;
    const b = bellGeo(0, 0);
    void b;
    const back = sprite(S, -0.6, -0.4, 0.6, 1.25, (g) => drawBell(g, this));
    const shadow = shadowOf(S, -0.6, -0.4, 0.6, 1.25, (g) => { bellPath(g); g.fill(); g.beginPath(); g.arc(0, 0, 0.17, 0, Math.PI * 2); g.fill(); });
    return { back, front: null, shadow };
  }

  /** Sprites for the parts tray: a chime seen from above, standing upright, as it lies in the kit box. */
  uprightChime(note: number): Sprite {
    const key = `u${note}`;
    const hit = this.uprightCache.get(key);
    if (hit) return hit;
    const len = chimeLengthFor(note), wd = 0.52;
    const col = ENAMEL[note];
    const s = sprite(this.scale, -0.14, -0.12, wd + 0.16, len + 0.2, (g) => {
      g.save();
      g.shadowColor = 'rgba(60,30,5,0.35)'; g.shadowBlur = 0.08 * this.scale; g.shadowOffsetY = 0.05 * this.scale;
      rrect(g, 0, 0, wd, len, 0.1); g.fillStyle = col; g.fill();
      g.restore();
      rrect(g, 0, 0, wd, len, 0.1);
      const eg = g.createLinearGradient(0, 0, wd, 0);
      eg.addColorStop(0, mix(col, '#ffffff', 0.22)); eg.addColorStop(0.5, col); eg.addColorStop(1, mix(col, '#000000', 0.25));
      g.fillStyle = eg; g.fill();
      rrect(g, 0.06, 0.06, 0.07, len - 0.12, 0.035); g.fillStyle = 'rgba(255,255,255,0.45)'; g.fill();
      for (const y of [0.2, len - 0.2]) {
        g.beginPath(); g.arc(wd / 2, y, 0.07, 0, Math.PI * 2); g.fillStyle = mix(col, '#000000', 0.55); g.fill();
        g.beginPath(); g.arc(wd / 2, y + 0.02, 0.07, 0.2, Math.PI - 0.2); g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.02; g.stroke();
      }
    });
    this.uprightCache.set(key, s);
    return s;
  }
  private uprightCache = new Map<string, Sprite>();

  woodTexture(): HTMLCanvasElement { return this.beech; }
}

function chimeLengthFor(note: number): number {
  return 1.95 * Math.sqrt(NOTES[0].hz / NOTES[note].hz);
}

/** An enamel chime bar along +x from 0 to len, centred on y = 0. */
export const BAR_H = 0.28;

export function drawBar(g: CanvasRenderingContext2D, len: number, col: string): void {
  const h = BAR_H;
  rrect(g, 0, -h / 2, len, h, 0.09);
  const eg = g.createLinearGradient(0, -h / 2, 0, h / 2);
  eg.addColorStop(0, mix(col, '#ffffff', 0.3)); eg.addColorStop(0.35, col); eg.addColorStop(1, mix(col, '#000000', 0.32));
  g.fillStyle = eg; g.fill();
  // Gloss along the top.
  rrect(g, 0.07, -h / 2 + 0.03, len - 0.14, 0.05, 0.025);
  g.fillStyle = 'rgba(255,255,255,0.55)'; g.fill();
  // A soft second reflection low down.
  rrect(g, 0.12, h / 2 - 0.065, len - 0.24, 0.025, 0.012);
  g.fillStyle = 'rgba(255,255,255,0.14)'; g.fill();
  // Steel rivets.
  for (const x of [0.2, len - 0.2]) {
    g.beginPath(); g.arc(x + 0.01, 0.016, 0.06, 0, Math.PI * 2); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fill();
    g.beginPath(); g.arc(x, 0.004, 0.055, 0, Math.PI * 2);
    const rg = g.createRadialGradient(x - 0.018, -0.016, 0.004, x, 0.004, 0.055);
    rg.addColorStop(0, '#ffffff'); rg.addColorStop(0.45, '#d5d9dd'); rg.addColorStop(1, '#6e737a');
    g.fillStyle = rg; g.fill();
  }
}

function bellPath(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.moveTo(0, 0.31);
  g.bezierCurveTo(0.13, 0.31, 0.2, 0.38, 0.21, 0.52);
  g.bezierCurveTo(0.22, 0.66, 0.26, 0.78, 0.37, 0.86);
  g.quadraticCurveTo(0.39, 0.92, 0.3, 0.93);
  g.lineTo(-0.3, 0.93);
  g.quadraticCurveTo(-0.39, 0.92, -0.37, 0.86);
  g.bezierCurveTo(-0.26, 0.78, -0.22, 0.66, -0.21, 0.52);
  g.bezierCurveTo(-0.2, 0.38, -0.13, 0.31, 0, 0.31);
  g.closePath();
}

/** A small cast brass bell hanging from a peg at (0, 0); it pivots at (0, 0.2). */
export function drawBell(g: CanvasRenderingContext2D, p: Painter): void {
  p.peg(g, 0, 0, 0.16);
  // Brass hanging loop.
  g.beginPath(); g.ellipse(0, 0.2, 0.065, 0.085, 0, 0, Math.PI * 2);
  g.strokeStyle = '#8a6219'; g.lineWidth = 0.045; g.stroke();
  g.beginPath(); g.ellipse(-0.01, 0.19, 0.06, 0.08, 0, Math.PI * 0.9, Math.PI * 1.6);
  g.strokeStyle = '#f2d27e'; g.lineWidth = 0.018; g.stroke();
  // Clapper peeking out under the lip.
  g.beginPath(); g.arc(0, 0.97, 0.065, 0, Math.PI * 2);
  const cg = g.createRadialGradient(-0.02, 0.95, 0.01, 0, 0.97, 0.065);
  cg.addColorStop(0, '#f8e3a0'); cg.addColorStop(1, '#7c5512');
  g.fillStyle = cg; g.fill();
  // Body.
  bellPath(g);
  const bg = g.createLinearGradient(-0.38, 0, 0.38, 0);
  bg.addColorStop(0, '#6b4710'); bg.addColorStop(0.2, '#b98a2b'); bg.addColorStop(0.36, '#f7e29a');
  bg.addColorStop(0.48, '#d7a640'); bg.addColorStop(0.75, '#9b6c1c'); bg.addColorStop(1, '#5e3e0c');
  g.fillStyle = bg; g.fill();
  // Shoulder light and the darker sound bow at the lip.
  g.save(); bellPath(g); g.clip();
  const vg = g.createLinearGradient(0, 0.31, 0, 0.93);
  vg.addColorStop(0, 'rgba(255,245,200,0.45)'); vg.addColorStop(0.25, 'rgba(255,245,200,0)');
  vg.addColorStop(0.82, 'rgba(70,40,5,0)'); vg.addColorStop(0.86, 'rgba(70,40,5,0.35)'); vg.addColorStop(0.92, 'rgba(255,230,160,0.35)'); vg.addColorStop(1, 'rgba(70,40,5,0.4)');
  g.fillStyle = vg; g.fillRect(-0.5, 0.2, 1, 0.8);
  g.restore();
  // Crown knob.
  g.beginPath(); g.arc(0, 0.3, 0.05, 0, Math.PI * 2);
  g.fillStyle = '#c9982f'; g.fill();
}

/** Clear glass: a faint tint, a darker refracting rim, the caustic opposite the light, and a sharp highlight. */
export function drawGlass(g: CanvasRenderingContext2D, r: number): void {
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2);
  const body = g.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.1, 0, 0, r);
  body.addColorStop(0, 'rgba(248,252,246,0.18)');
  body.addColorStop(0.7, 'rgba(205,222,212,0.30)');
  body.addColorStop(0.92, 'rgba(110,140,128,0.55)');
  body.addColorStop(1, 'rgba(60,85,78,0.75)');
  g.fillStyle = body; g.fill();
  // Caustic: light focused through the sphere, low on the far side.
  const cg = g.createRadialGradient(r * 0.28, r * 0.42, 0, r * 0.28, r * 0.42, r * 0.55);
  cg.addColorStop(0, 'rgba(255,255,236,0.85)'); cg.addColorStop(1, 'rgba(255,255,236,0)');
  g.beginPath(); g.arc(0, 0, r * 0.94, 0, Math.PI * 2); g.fillStyle = cg; g.fill();
  // Window highlight.
  g.save(); g.translate(-r * 0.38, -r * 0.42); g.rotate(-0.6);
  g.beginPath(); g.ellipse(0, 0, r * 0.26, r * 0.15, 0, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.fill();
  g.restore();
  g.beginPath(); g.arc(r * 0.05, -r * 0.62, r * 0.07, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
  // Rim line.
  g.beginPath(); g.arc(0, 0, r - 0.006, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(40,60,55,0.45)'; g.lineWidth = 0.014; g.stroke();
}
