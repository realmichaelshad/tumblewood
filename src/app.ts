// The toy itself: layout, the clock, drawing each frame, touch and mouse input, sound triggering and attract mode.

import {
  BOARD, CHIME_TILT, CUP_Y, MAX_PIECES, cupFits, encode, nearestFit, pieceShapes, placement, chimeGeo, rampGeo,
  type Board, type Piece, type Problem,
} from './board/board.ts';
import { Run } from './sim/run.ts';
import type { HitEvent } from './sim/physics.ts';
import { Sound } from './audio/sound.ts';
import { Painter, ENAMEL, BLUE } from './render/paint.ts';
import { attractStep, CYCLE_STEPS, MOVES, movePose } from './attract.ts';
import { starter } from './board/starter.ts';

const DT = 1 / 240;

type TrayItem = { kind: 'ramp' } | { kind: 'bell' } | { kind: 'chime'; note: number };
interface TrayCell { item: TrayItem; x: number; y: number; w: number; h: number; }

interface Held {
  piece: Piece;
  /** Index on the board it came from, or -1 for a new piece from the tray. */
  from: number;
  /** Pointer in world units, and the offset from the pointer to the piece's anchor. */
  px: number; py: number; gx: number; gy: number;
  /** Visual anchor (smoothed) for drawing. */
  vx: number; vy: number;
  touch: boolean;
  lift: number;
  target: Piece | null;
  problem: Problem;
  overTray: boolean;
}

interface Settle { index: number; fx: number; fy: number; t0: number; dur: number; flipFrom?: boolean; }
interface Ring { x: number; y: number; t0: number; color: string; k: number; }

export interface AppOptions {
  capture: boolean;
  attract: boolean;
  reducedMotion: boolean;
  onBoardChange: (b: Board) => void;
  onAttractEnd: () => void;
  onFirstSound: () => void;
}

/** Centre of a piece relative to its anchor, for grabbing and animation. */
function centreOf(p: Piece): [number, number] {
  if (p.kind === 'ramp') { const g = rampGeo(0, 0, p.flip); return [(g.hx + g.ex) / 2, (g.hy + g.ey) / 2]; }
  if (p.kind === 'bell') return [0, 0.5];
  return [0, 0];
}

export class App {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly painter = new Painter();
  readonly sound = new Sound();
  run: Run;
  opts: AppOptions;
  // Layout, in CSS pixels.
  W = 0; H = 0; dpr = 1; S = 30; ox = 0; oy = 0;
  tray: TrayCell[] = [];
  trayBox = { x: 0, y: 0, w: 0, h: 0, vertical: false };
  hint = { x: 0, y: 0, w: 0, lines: [] as string[], under: false };
  // Clock.
  time = 0; // app seconds (UI animations)
  private acc = 0;
  private last = -1;
  private raf = 0;
  private visible = true;
  private onScreen = true;
  // State.
  held: Held | null = null;
  private press: { x: number; y: number; t: number; id: number; target: ReturnType<App['hitTest']>; moved: boolean } | null = null;
  private settles: Settle[] = [];
  private rings: Ring[] = [];
  private strikes = new Map<number, { t0: number; k: number; dir: number }>();
  private cupDrag: { col: number; x: number } | null = null;
  attract: boolean;
  private attractStep0 = 0;
  private cupPulse = -10;
  private refuse = new Map<number, number>();

  constructor(canvas: HTMLCanvasElement, board: Board, opts: AppOptions) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.opts = opts;
    this.attract = opts.attract;
    this.run = new Run(board);
    if (this.attract) this.startAttract();
    this.bindInput();
  }

  // ------------------------------------------------------------------ layout

  resize(w: number, h: number): void {
    this.W = w; this.H = h;
    const phone = Math.min(w, h) < 600;
    this.dpr = Math.min(window.devicePixelRatio || 1, phone ? 2 : 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    const bx0 = BOARD.x0 - 0.2, bx1 = BOARD.x1 + 0.4, by0 = BOARD.y0 - 0.15, by1 = BOARD.y1 + 0.55;
    const bw = bx1 - bx0, bh = by1 - by0;
    const pad = phone ? 10 : 22;
    let availW = w - pad * 2, availH = h - pad * 2;
    const showTray = !this.attract;
    let trayMode: 'none' | 'rows' | 'col' = 'none';
    if (showTray) trayMode = w / h > 0.95 ? 'col' : 'rows';
    const trayH = trayMode === 'rows' ? 128 : 0;
    const trayW = trayMode === 'col' ? Math.min(230, Math.max(170, w * 0.24)) : 0;
    const gap = trayMode === 'col' ? (phone ? 10 : 28) : 8;
    availH -= trayH + (trayMode === 'rows' ? gap : 0);
    availW -= trayW + (trayMode === 'col' ? gap : 0);
    this.S = Math.max(8, Math.min(availW / bw, availH / bh, phone ? 60 : 64));
    const usedW = bw * this.S, usedH = bh * this.S;
    if (trayMode === 'col') {
      const groupW = usedW + gap + trayW;
      const left = Math.max(pad, (w - groupW) / 2);
      this.ox = left - bx0 * this.S;
      this.oy = pad + (availH - usedH) / 2 - by0 * this.S;
      const th = Math.min(h - pad * 2 - 50, trayW * 1.45);
      this.layoutTray(left + usedW + gap, this.oy + by0 * this.S + (usedH - th) / 2 - 20, trayW, th, trayMode);
    } else {
      this.ox = (w - usedW) / 2 - bx0 * this.S;
      const totalH = usedH + (trayMode === 'none' ? 0 : trayH + gap);
      const top = Math.max(pad, (h - totalH) / 2);
      this.oy = top - by0 * this.S;
      if (trayMode !== 'none') {
        const tw = Math.min(w - pad * 2, Math.max(usedW - 0.5 * this.S, 300), 520);
        this.layoutTray((w - tw) / 2, top + usedH + gap, tw, trayH, trayMode);
      } else { this.tray = []; this.hint = { x: 0, y: 0, w: 0, lines: [], under: false }; }
    }
    this.painter.setScale(this.S * this.dpr);
  }

  private layoutTray(x: number, y: number, w: number, h: number, mode: 'rows' | 'col'): void {
    this.trayBox = { x, y, w, h, vertical: mode === 'col' };
    const cells: TrayCell[] = [];
    const inset = 8;
    const chimes: TrayItem[] = [0, 1, 2, 3, 4, 5, 6, 7].map((note) => ({ kind: 'chime', note }));
    if (mode === 'rows') {
      const iw = w - inset * 2;
      const rowA = (h - inset * 2) * 0.56, rowB = h - inset * 2 - rowA;
      const cw = iw / 8;
      chimes.forEach((it, i) => cells.push({ item: it, x: x + inset + i * cw, y: y + inset, w: cw, h: rowA }));
      const rampW = Math.min(120, iw * 0.34);
      cells.push({ item: { kind: 'ramp' }, x: x + inset, y: y + inset + rowA, w: rampW, h: rowB });
      cells.push({ item: { kind: 'bell' }, x: x + inset + rampW + 4, y: y + inset + rowA, w: 46, h: rowB });
      const hx = x + inset + rampW + 4 + 46 + 10;
      this.hint = { x: hx, y: y + inset + rowA + rowB / 2, w: x + w - inset - hx, lines: ['Drag parts onto the board.', 'Drag them back to remove.'], under: false };
    } else {
      const ih = h - inset * 2, iw = w - inset * 2;
      const rampH = Math.min(64, ih * 0.2);
      cells.push({ item: { kind: 'ramp' }, x: x + inset, y: y + inset, w: iw * 0.66, h: rampH });
      cells.push({ item: { kind: 'bell' }, x: x + inset + iw * 0.66, y: y + inset, w: iw * 0.34, h: rampH });
      const top = y + inset + rampH + 6;
      const ch = (ih - rampH - 6) / 2;
      const cw = iw / 4;
      chimes.forEach((it, i) => cells.push({ item: it, x: x + inset + (i % 4) * cw, y: top + Math.floor(i / 4) * ch, w: cw, h: ch }));
      this.hint = { x, y: y + h + 22, w, lines: ['Drag parts onto the board.', 'Drag them back to remove.'], under: true };
    }
    this.tray = cells;
  }

  toWorld(x: number, y: number): [number, number] { return [(x - this.ox) / this.S, (y - this.oy) / this.S]; }
  toScreen(x: number, y: number): [number, number] { return [this.ox + x * this.S, this.oy + y * this.S]; }

  // ------------------------------------------------------------------ clock

  start(): void {
    if (this.opts.capture) { this.draw(); return; }
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      if (this.last < 0) this.last = now;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.advance(dt);
      this.draw();
    };
    cancelAnimationFrame(this.raf);
    this.last = -1;
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void { cancelAnimationFrame(this.raf); this.raf = 0; }

  setActive(visible: boolean, onScreen: boolean): void {
    const was = this.visible && this.onScreen;
    this.visible = visible; this.onScreen = onScreen;
    const now = visible && onScreen;
    if (now === was || this.opts.capture) return;
    if (now) { this.sound.resume(); this.start(); } else { this.stop(); this.sound.suspend(); }
  }

  get running(): boolean { return this.raf !== 0; }

  /** Advance the app clock by dt seconds: fixed physics steps, then sound and effects for what happened. */
  advance(dt: number): void {
    this.time += dt;
    this.acc += dt;
    const w = this.run.world;
    const events: HitEvent[] = [];
    let n = 0;
    while (this.acc >= DT - 1e-9 && n < 40) {
      this.acc -= DT;
      if (this.attract) attractStep(this.run, (w.steps - this.attractStep0) % CYCLE_STEPS);
      this.run.step();
      n++;
    }
    events.push(...w.takeEvents());
    const now = w.time;
    for (const e of events) this.react(e, e.t - now);
    // Rolling sound from marbles on wood.
    let roll = 0;
    for (const m of w.marbles) if (m.touching && (m.rollingOn === 'ramp' || m.rollingOn === 'tray')) roll += Math.abs(m.vx) + Math.abs(m.vy);
    this.sound.rolling(roll);
  }

  /** Sound and a visible answer for one hit. `ago` is how long before the end of this frame it happened (<= 0). */
  private react(e: HitEvent, ago: number): void {
    const when = Math.max(0, 0.03 + ago);
    const piece = e.owner >= 0 ? this.run.board.pieces[e.owner] : null;
    if (piece?.kind === 'chime') {
      this.sound.chime(piece.note, e.speed, e.x, when);
      this.strike(e.owner, e.speed, e.x - piece.c);
      if (e.speed > 1.6) this.rings.push({ x: e.x, y: e.y, t0: this.time + ago, color: ENAMEL[piece.note], k: Math.min(1, e.speed / 10) });
    } else if (piece?.kind === 'bell') {
      this.sound.bell(e.speed, e.x, when);
      this.strike(e.owner, e.speed, e.x - piece.c);
      if (e.speed > 1.6) this.rings.push({ x: e.x, y: e.y, t0: this.time + ago, color: '#f0b323', k: Math.min(1, e.speed / 10) });
    } else if (e.tag === 'ramp') this.sound.knock(e.speed, e.x, when);
    else if (e.tag === 'tray') this.sound.tray(e.speed, e.x, when);
    else if (e.tag === 'glass') this.sound.glass(e.speed, e.x, when);
  }

  private strike(index: number, speed: number, dx: number): void {
    const k = Math.min(1, speed / 11) * (this.opts.reducedMotion ? 0.4 : 1);
    this.strikes.set(index, { t0: this.time, k, dir: dx >= 0 ? -1 : 1 });
  }

  // ------------------------------------------------------------------ actions

  ensureSound(): void {
    if (this.attract || this.opts.capture) return;
    const first = !this.sound.ctx;
    this.sound.start();
    if (first && this.sound.ctx) this.opts.onFirstSound();
  }

  drop(): void {
    this.ensureSound();
    this.run.drop();
    this.cupPulse = this.time;
  }

  setBeat(on: boolean): void {
    this.ensureSound();
    this.run.setBeat(on);
  }

  get beat(): boolean { return this.run.nextDrop >= 0; }

  setBoard(b: Board): void {
    this.run.setBoard(b);
    this.strikes.clear();
    this.settles = [];
  }

  private changed(): void {
    this.run.rebuild();
    this.opts.onBoardChange(this.run.board);
  }

  private startAttract(): void {
    // Two silent cycles first, so marbles are already in flight on the first frame and the loop is seamless.
    // The last second and a half runs through the effects too, so rings and shivers already on the first frame
    // match the end of the loop.
    const w = this.run.world;
    const tail = 360;
    for (let s = 0; s < CYCLE_STEPS * 2; s++) {
      attractStep(this.run, s % CYCLE_STEPS);
      this.run.step();
      const ev = w.takeEvents();
      if (s >= CYCLE_STEPS * 2 - tail) { this.time += DT; for (const e of ev) this.react(e, 0); }
    }
    this.attractStep0 = 0;
  }

  endAttract(): void {
    if (!this.attract) return;
    this.attract = false;
    // Every piece the script moved goes back to where the starter run has it; marbles keep rolling.
    const start = starter();
    for (const m of MOVES) this.run.board.pieces[m.piece] = { ...start.pieces[m.piece] };
    this.run.lifted.clear();
    this.run.rebuild();
    this.resize(this.W, this.H);
    this.opts.onAttractEnd();
    this.opts.onBoardChange(this.run.board);
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e));
    c.addEventListener('pointercancel', (e) => this.cancel(e));
    // A touch that starts on a piece must not scroll the page; one on empty board may.
    c.addEventListener('touchstart', (e) => {
      if (this.attract) return;
      const t = e.touches[0];
      if (!t) return;
      const r = c.getBoundingClientRect();
      if (this.hitTest(t.clientX - r.left, t.clientY - r.top)) e.preventDefault();
    }, { passive: false });
  }

  hitTest(x: number, y: number): { type: 'piece'; index: number } | { type: 'tray'; cell: TrayCell } | { type: 'cup' } | null {
    for (const cell of this.tray) if (x >= cell.x && x <= cell.x + cell.w && y >= cell.y && y <= cell.y + cell.h) return { type: 'tray', cell };
    const [wx, wy] = this.toWorld(x, y);
    const pad = Math.max(0.4, 22 / this.S);
    let best = -1, bd = Infinity;
    const ps = this.run.board.pieces;
    for (let i = ps.length - 1; i >= 0; i--) {
      if (this.run.lifted.has(i)) continue;
      for (const s of pieceShapes(ps[i])) {
        let d: number;
        if ('circ' in s) d = Math.hypot(wx - s.circ[0], wy - s.circ[1]) - s.r;
        else {
          const [ax, ay, bx, by] = s.cap;
          const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
          let t = l2 ? ((wx - ax) * ex + (wy - ay) * ey) / l2 : 0;
          t = Math.max(0, Math.min(1, t));
          d = Math.hypot(wx - ax - ex * t, wy - ay - ey * t) - s.r;
        }
        // Prefer small pieces on top of ramps.
        if (ps[i].kind !== 'ramp') d -= 0.12;
        if (d < pad && d < bd) { bd = d; best = i; }
      }
    }
    const cupD = Math.hypot(wx - this.run.board.cup, wy - (CUP_Y - 0.15));
    if (cupD < Math.max(0.6, 24 / this.S) && cupD < bd + 0.2) return { type: 'cup' };
    return best >= 0 ? { type: 'piece', index: best } : null;
  }

  private local(e: PointerEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private down(e: PointerEvent): void {
    if (this.attract) { this.endAttract(); return; }
    if (this.press) return;
    const [x, y] = this.local(e);
    const target = this.hitTest(x, y);
    this.ensureSound();
    if (!target) return;
    e.preventDefault();
    this.canvas.setPointerCapture(e.pointerId);
    this.press = { x, y, t: performance.now(), id: e.pointerId, target, moved: false };
  }

  private move(e: PointerEvent): void {
    const [x, y] = this.local(e);
    if (!this.press || e.pointerId !== this.press.id) {
      if (e.pointerType === 'mouse' && !this.press) this.canvas.style.cursor = this.hitTest(x, y) ? 'grab' : 'default';
      return;
    }
    const p = this.press;
    if (!p.moved && Math.hypot(x - p.x, y - p.y) > 6) {
      p.moved = true;
      if (p.target?.type === 'piece') this.pick(p.target.index, p.x, p.y, e.pointerType !== 'mouse');
      else if (p.target?.type === 'tray') this.pickNew(p.target.cell.item, x, y, e.pointerType !== 'mouse');
      else if (p.target?.type === 'cup') this.cupDrag = { col: this.run.board.cup, x: this.toWorld(x, y)[0] };
    }
    if (this.held) this.drag(x, y);
    if (this.cupDrag) {
      const [wx] = this.toWorld(x, y);
      this.cupDrag.x = wx;
      const c = Math.round(wx);
      if (c !== this.run.board.cup && cupFits(this.run.board, c)) { this.run.board.cup = c; this.opts.onBoardChange(this.run.board); }
    }
    if (this.held || this.cupDrag) this.canvas.style.cursor = 'grabbing';
  }

  private up(e: PointerEvent): void {
    const p = this.press;
    if (!p || e.pointerId !== p.id) return;
    this.press = null;
    if (this.held) { this.release(); return; }
    if (this.cupDrag) { this.cupDrag = null; return; }
    if (!p.moved && p.target) this.tap(p.target);
  }

  private cancel(e: PointerEvent): void {
    if (!this.press || e.pointerId !== this.press.id) return;
    this.press = null;
    if (this.held) this.release();
    this.cupDrag = null;
  }

  private tap(t: NonNullable<ReturnType<App['hitTest']>>): void {
    if (t.type === 'cup') { this.drop(); return; }
    if (t.type === 'tray') {
      const it = t.cell.item;
      if (it.kind === 'chime') this.sound.chime(it.note, 8, 4.5);
      else if (it.kind === 'bell') this.sound.bell(8, 4.5);
      else this.sound.knock(10, 4.5);
      return;
    }
    const i = t.index, p = this.run.board.pieces[i];
    if (p.kind === 'bell') {
      this.sound.bell(9, p.c);
      this.strike(i, 9, 0.2);
      return;
    }
    const flipped = { ...p, flip: !p.flip } as Piece;
    const q = placement(this.run.board, flipped, i) === 'ok' ? flipped : nearestFit(this.run.board, flipped, p.c, p.r, i, 3);
    if (!q) {
      this.refuse.set(i, this.time);
      this.sound.knock(5, p.c);
      return;
    }
    const [fx, fy] = [p.c + centreOf(p)[0] - centreOf(q)[0], p.r + centreOf(p)[1] - centreOf(q)[1]];
    this.run.board.pieces[i] = q;
    this.settles = this.settles.filter((s) => s.index !== i);
    this.settles.push({ index: i, fx, fy, t0: this.time, dur: this.opts.reducedMotion ? 0.01 : 0.24, flipFrom: true });
    if (q.kind === 'chime') { this.sound.chime(q.note, 4, q.c); this.strike(i, 4, 0); } else this.sound.knock(7, q.c + 2.5);
    this.changed();
  }

  private pick(index: number, x: number, y: number, touch: boolean): void {
    const p = this.run.board.pieces[index];
    const [wx, wy] = this.toWorld(x, y);
    this.run.lifted.add(index);
    this.run.rebuild();
    this.held = { piece: { ...p }, from: index, px: wx, py: wy, gx: p.c - wx, gy: p.r - wy, vx: p.c, vy: p.r, touch, lift: 0, target: { ...p }, problem: 'ok', overTray: false };
    this.sound.knock(4, p.c);
  }

  private pickNew(item: TrayItem, x: number, y: number, touch: boolean): void {
    if (this.run.board.pieces.length >= MAX_PIECES) return;
    const piece: Piece = item.kind === 'ramp' ? { kind: 'ramp', c: 0, r: 0, flip: false } : item.kind === 'bell' ? { kind: 'bell', c: 0, r: 0 } : { kind: 'chime', c: 0, r: 0, flip: false, note: item.note };
    const [wx, wy] = this.toWorld(x, y);
    const [cx, cy] = centreOf(piece);
    this.held = { piece, from: -1, px: wx, py: wy, gx: -cx, gy: -cy, vx: wx - cx, vy: wy - cy, touch, lift: 0, target: null, problem: 'outside', overTray: true };
  }

  private drag(x: number, y: number): void {
    const h = this.held!;
    const [wx, wy] = this.toWorld(x, y);
    h.px = wx; h.py = wy;
    // On touch, the piece floats a little above the fingertip so it stays in view.
    const lift = h.touch ? 0.9 : 0;
    const ax = wx + h.gx, ay = wy + h.gy - lift;
    const tb = this.trayBox;
    h.overTray = this.tray.length > 0 && x >= tb.x - 6 && x <= tb.x + tb.w + 6 && y >= tb.y - 6 && y <= tb.y + tb.h + 6;
    if (h.overTray) { h.target = null; h.problem = 'outside'; return; }
    const exact = { ...h.piece, c: Math.round(ax), r: Math.round(ay) } as Piece;
    h.problem = placement(this.run.board, exact, h.from);
    h.target = h.problem === 'ok' ? exact : nearestFit(this.run.board, h.piece, ax, ay, h.from, 4);
  }

  private release(): void {
    const h = this.held!;
    this.held = null;
    const lift = h.touch ? 0.9 : 0;
    const vx = h.px + h.gx, vy = h.py + h.gy - lift;
    if (h.overTray) {
      if (h.from >= 0) {
        this.run.board.pieces.splice(h.from, 1);
        this.remapAfterRemove(h.from);
        this.run.lifted.clear();
        this.sound.knock(5, 4.5, 0, true);
        this.changed();
      }
      return;
    }
    let target = h.target;
    if (!target && h.from >= 0) target = this.run.board.pieces[h.from];
    this.run.lifted.clear();
    if (!target) { this.run.rebuild(); return; }
    let index = h.from;
    if (index >= 0) this.run.board.pieces[index] = target;
    else { this.run.board.pieces.push(target); index = this.run.board.pieces.length - 1; }
    this.settles = this.settles.filter((s) => s.index !== index);
    this.settles.push({ index, fx: vx, fy: vy, t0: this.time, dur: this.opts.reducedMotion ? 0.01 : 0.18 });
    if (target.kind === 'chime') this.sound.chime(target.note, 3, target.c); else this.sound.knock(6, target.c);
    this.changed();
  }

  private remapAfterRemove(i: number): void {
    const next = new Map<number, { t0: number; k: number; dir: number }>();
    this.strikes.forEach((v, k) => { if (k < i) next.set(k, v); else if (k > i) next.set(k - 1, v); });
    this.strikes = next;
    this.settles = this.settles.filter((s) => s.index !== i).map((s) => (s.index > i ? { ...s, index: s.index - 1 } : s));
  }

  // ------------------------------------------------------------------ drawing

  draw(): void {
    const g = this.ctx, d = this.dpr, S = this.S, P = this.painter;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (!P.board) return;
    // Board (with its shadow, holes and the inside of the tray).
    const [bx, by] = P.boardOrigin;
    g.drawImage(P.board, (this.ox + bx * S) * d, (this.oy + by * S) * d);
    g.setTransform(d * S, 0, 0, d * S, this.ox * d, this.oy * d);
    const w = this.run.world;
    const pieces = this.run.board.pieces;
    const step = (w.steps - this.attractStep0) % CYCLE_STEPS;
    // Where each piece is drawn this frame.
    const poses: Pose[] = [];
    pieces.forEach((p, i) => {
      if (this.held && this.held.from === i) return;
      let x = p.c, y = p.r, lift = 0, flipK = 1, rot = 0, shown = p;
      const st = this.settles.find((s) => s.index === i);
      if (st) {
        const t = Math.min(1, (this.time - st.t0) / st.dur);
        const k = 1 - Math.pow(1 - t, 3);
        x = st.fx + (p.c - st.fx) * k; y = st.fy + (p.r - st.fy) * k;
        if (st.flipFrom && 'flip' in p) {
          // Turns over through edge-on: the old way round for the first half, the new way for the second.
          flipK = Math.max(0.02, Math.abs(1 - 2 * t));
          if (t < 0.5) shown = { ...p, flip: !p.flip };
        }
        lift = Math.sin(Math.PI * t) * 0.6;
        if (t >= 1) this.settles = this.settles.filter((s) => s !== st);
      }
      if (this.attract && this.run.lifted.has(i)) {
        for (const m of MOVES) {
          if (m.piece !== i) continue;
          const pose = movePose(m, step);
          if (!pose) continue;
          const [fcx, fcy] = centreOf(m.from), [tcx, tcy] = centreOf(m.to);
          const k = pose.k;
          const cx = m.from.c + fcx + (m.to.c + tcx - m.from.c - fcx) * k;
          const cy = m.from.r + fcy + (m.to.r + tcy - m.from.r - fcy) * k - pose.lift * 0.5;
          const turns = 'flip' in m.from && 'flip' in m.to && m.from.flip !== m.to.flip;
          // A ramp turns over (squashes through edge-on); a chime simply tilts the other way as it travels.
          const squash = turns && m.from.kind === 'ramp';
          shown = (squash ? (k < 0.5 ? m.from : m.to) : m.from) as Piece;
          const [scx, scy] = centreOf(shown);
          x = cx - scx; y = cy - scy;
          lift = pose.lift;
          if (squash) flipK = k < 0.5 ? 1 - 2 * k : -1 + 2 * k;
          if (turns && m.from.kind === 'chime') rot = (m.from.flip ? 1 : -1) * 2 * CHIME_TILT * k;
        }
      }
      poses.push({ p: shown, x, y, lift, flipK, rot, alpha: 1 });
    });
    // Shadows, then backs of pieces.
    const order = poses.map((_, i) => i).sort((a, b) => rank(poses[a].p) - rank(poses[b].p));
    const idxOf = (k: number) => { let n = -1; for (let i = 0; i < pieces.length; i++) { if (this.held && this.held.from === i) continue; n++; if (n === k) return i; } return -1; };
    for (const k of order) this.drawPiece(poses[k], 'shadow', idxOf(k));
    // The cup (inside) and its waiting marble.
    const cupX = this.run.board.cup;
    this.blit(P.cupBack!, cupX, 0);
    for (const k of order) this.drawPiece(poses[k], 'back', idxOf(k));
    this.drawMarble(cupX, CUP_Y - 0.22, 0, 1, false);
    // Marbles.
    for (const m of w.marbles) {
      const a = m.fade >= 0 ? Math.max(0, m.fade / 0.5) : 1;
      this.drawMarble(m.x, m.y, m.angle, a, true);
    }
    // Fronts: ramps, then the cup and the tray front.
    for (const k of order) this.drawPiece(poses[k], 'front', idxOf(k));
    this.blit(P.cupFront!, cupX, 0, 1, 1 + 0.06 * Math.max(0, 1 - (this.time - this.cupPulse) / 0.25));
    this.blit(P.boardFront!, 0, 0);
    this.drawRings();
    if (this.attract) this.drawFinger(step);
    // Parts tray and the piece in the hand.
    g.setTransform(d, 0, 0, d, 0, 0);
    if (this.tray.length) this.drawTray();
    if (this.held) this.drawHeld();
  }

  private blit(s: { img: HTMLCanvasElement; x0: number; y0: number; w: number; h: number }, x: number, y: number, alpha = 1, sy = 1): void {
    const g = this.ctx;
    if (alpha < 1) g.globalAlpha = alpha;
    if (sy !== 1) {
      g.save(); g.translate(x, y + CUP_Y + 0.3); g.scale(2 - sy, sy); g.translate(-x, -(y + CUP_Y + 0.3));
      g.drawImage(s.img, x + s.x0, y + s.y0, s.w, s.h);
      g.restore();
    } else g.drawImage(s.img, x + s.x0, y + s.y0, s.w, s.h);
    if (alpha < 1) g.globalAlpha = 1;
  }

  private drawPiece(pose: Pose, layer: 'shadow' | 'back' | 'front', index: number): void {
    const g = this.ctx;
    const sp = this.painter.sprites(pose.p);
    const s = layer === 'shadow' ? sp.shadow : layer === 'back' ? sp.back : sp.front;
    if (!s) return;
    g.save();
    let x = pose.x, y = pose.y;
    const [cx, cy] = centreOf(pose.p);
    if (layer === 'shadow') { x += pose.lift * 0.22; y += pose.lift * 0.34; g.globalAlpha = 1 - pose.lift * 0.35; }
    else y -= pose.lift * 0.08;
    g.translate(x, y);
    // A refused flip shakes.
    const rf = this.refuse.get(index);
    if (rf !== undefined) {
      const t = this.time - rf;
      if (t < 0.3) g.translate(Math.sin(t * 60) * 0.06 * (1 - t / 0.3), 0); else this.refuse.delete(index);
    }
    if (pose.flipK !== 1) { g.translate(cx, cy); g.scale(Math.max(0.02, Math.abs(pose.flipK)), 1); g.translate(-cx, -cy); }
    if (pose.rot) { g.translate(cx, cy); g.rotate(pose.rot); g.translate(-cx, -cy); }
    if (pose.lift > 0 && layer !== 'shadow') { const k = 1 + pose.lift * 0.05; g.translate(cx, cy); g.scale(k, k); g.translate(-cx, -cy); }
    // Struck pieces: a chime shivers along its length; a bell swings on its loop.
    const st = this.strikes.get(index);
    if (st && layer !== 'shadow') {
      const t = this.time - st.t0;
      if (t > 1.4) this.strikes.delete(index);
      else if (pose.p.kind === 'chime') {
        const c = chimeGeo(0, 0, pose.p.flip, pose.p.note);
        const a = st.k * Math.exp(-t * 5.5) * Math.sin(t * 2 * Math.PI * 11);
        const nx = -Math.sin(c.angle), ny = Math.cos(c.angle);
        g.translate(nx * a * 0.07, ny * a * 0.07);
        g.rotate(a * 0.025);
      } else if (pose.p.kind === 'bell') {
        const a = st.dir * st.k * Math.exp(-t * 2.6) * Math.sin(t * 2 * Math.PI * 2.4);
        g.translate(0, 0.2); g.rotate(a * 0.35); g.translate(0, -0.2);
      }
    }
    g.drawImage(s.img, s.x0, s.y0, s.w, s.h);
    // A moment of brightness on a struck chime.
    if (st && layer === 'back' && pose.p.kind === 'chime') {
      const t = this.time - st.t0;
      const glow = st.k * Math.max(0, 1 - t / 0.35);
      if (glow > 0.01) {
        const c = chimeGeo(0, 0, pose.p.flip, pose.p.note);
        g.save(); g.translate(c.ax, c.ay); g.rotate(c.angle);
        g.globalAlpha = glow * 0.55; g.fillStyle = '#ffffff';
        g.beginPath(); g.roundRect(0, -0.14, c.len, 0.28, 0.1); g.fill();
        g.restore();
      }
    }
    g.restore();
  }

  private drawMarble(x: number, y: number, angle: number, alpha: number, shadow: boolean): void {
    const g = this.ctx, P = this.painter;
    if (alpha <= 0) return;
    g.globalAlpha = alpha;
    if (shadow) { const s = P.marbleShadow!; g.drawImage(s.img, x + s.x0 + 0.07, y + s.y0 + 0.11, s.w, s.h); }
    const s = P.marble!;
    g.drawImage(s.img, x + s.x0, y + s.y0, s.w, s.h);
    if (shadow) {
      // A tiny seed bubble inside the glass turns with the marble, so you can see it roll.
      const r = 0.15;
      g.beginPath(); g.arc(x + Math.cos(angle) * r, y + Math.sin(angle) * r, 0.025, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.7)'; g.fill();
    }
    g.globalAlpha = 1;
  }

  private drawRings(): void {
    const g = this.ctx;
    const life = 0.55;
    this.rings = this.rings.filter((r) => this.time - r.t0 < life);
    for (const r of this.rings) {
      const t = Math.max(0, (this.time - r.t0) / life);
      const e = 1 - Math.pow(1 - t, 2.2);
      g.beginPath(); g.arc(r.x, r.y, 0.12 + e * (0.45 + 0.4 * r.k), 0, Math.PI * 2);
      g.strokeStyle = r.color;
      g.globalAlpha = (1 - t) * (0.5 + 0.5 * r.k);
      g.lineWidth = 0.07 * (1 - t) + 0.015;
      g.stroke();
      // A small bright core at the instant of the hit.
      if (t < 0.25) {
        g.globalAlpha = (1 - t / 0.25) * 0.85 * r.k;
        g.beginPath(); g.arc(r.x, r.y, 0.09 + 0.08 * t, 0, Math.PI * 2);
        g.fillStyle = '#fffbe8'; g.fill();
      }
    }
    g.globalAlpha = 1;
  }

  /** The fingertip that moves pieces in attract mode. */
  private drawFinger(step: number): void {
    const g = this.ctx;
    const t = step / 240;
    for (const m of MOVES) {
      if (!m.finger) continue;
      const f = m.finger;
      if (t < f.in || t > f.out) continue;
      const fade = Math.min(1, (t - f.in) / 0.25, (f.out - t) / 0.25);
      const [fcx, fcy] = centreOf(m.from), [tcx, tcy] = centreOf(m.to);
      const pose = movePose(m, step);
      const k = pose ? pose.k : t * 240 >= m.set ? 1 : 0;
      let x = m.from.c + fcx + (m.to.c + tcx - m.from.c - fcx) * k;
      let y = m.from.r + fcy + (m.to.r + tcy - m.from.r - fcy) * k;
      if (f.tap) { x = m.from.c + fcx; y = m.from.r + fcy; }
      x += 0.42; y += 0.34;
      const pressT = f.tap ? m.lift / 240 - 0.1 : m.lift / 240;
      const pressed = t >= pressT - 0.12 && t <= (f.tap ? pressT + 0.12 : m.set / 240 + 0.05);
      const r = pressed ? 0.27 : 0.33;
      g.save();
      g.globalAlpha = fade;
      g.beginPath(); g.arc(x + 0.05, y + 0.1 + (pressed ? 0 : 0.08), r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(20,30,70,0.22)'; g.fill();
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      g.fillStyle = 'rgba(255,255,255,0.5)'; g.fill();
      g.lineWidth = 0.05; g.strokeStyle = 'rgba(255,255,255,0.95)'; g.stroke();
      if (f.tap && Math.abs(t - pressT) < 0.4) {
        const q = Math.max(0, (t - pressT + 0.05) / 0.45);
        if (q > 0 && q < 1) { g.globalAlpha = fade * (1 - q); g.beginPath(); g.arc(x, y, r + q * 0.7, 0, Math.PI * 2); g.strokeStyle = '#ffffff'; g.lineWidth = 0.06; g.stroke(); }
      }
      g.restore();
    }
  }

  private drawTray(): void {
    const g = this.ctx, P = this.painter, tb = this.trayBox;
    const removing = this.held?.overTray && this.held.from >= 0;
    // A shallow beech tray.
    g.save();
    g.shadowColor = 'rgba(8,22,70,0.35)'; g.shadowBlur = 14; g.shadowOffsetY = 6;
    g.beginPath(); g.roundRect(tb.x, tb.y, tb.w, tb.h, 12);
    g.fillStyle = '#d7a670'; g.fill();
    g.restore();
    g.save();
    g.beginPath(); g.roundRect(tb.x, tb.y, tb.w, tb.h, 12); g.clip();
    g.drawImage(P.woodTexture(), 0, 40, 1024, 120, tb.x, tb.y, tb.w, tb.h);
    g.restore();
    g.beginPath(); g.roundRect(tb.x + 5, tb.y + 5, tb.w - 10, tb.h - 10, 8);
    g.fillStyle = removing ? 'rgba(120,60,20,0.32)' : 'rgba(150,95,45,0.14)'; g.fill();
    g.beginPath(); g.roundRect(tb.x + 1, tb.y + 1, tb.w - 2, tb.h - 2, 11);
    g.strokeStyle = 'rgba(255,245,225,0.6)'; g.lineWidth = 1.5; g.stroke();
    if (removing) {
      g.beginPath(); g.roundRect(tb.x - 3, tb.y - 3, tb.w + 6, tb.h + 6, 14);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 3; g.stroke();
    }
    for (const cell of this.tray) this.drawTrayItem(cell);
    if (this.hint.lines.length) {
      const under = this.hint.under;
      g.fillStyle = under ? 'rgba(255,255,255,0.92)' : '#4f2d10';
      g.font = `650 ${under ? 14 : 12.5}px "Figtree Variable", system-ui, sans-serif`;
      g.textBaseline = 'middle';
      g.textAlign = under ? 'center' : 'left';
      const lines = this.fitLines(this.hint.lines, this.hint.w);
      const hx = under ? this.hint.x + this.hint.w / 2 : this.hint.x;
      lines.forEach((l, i) => g.fillText(l, hx, this.hint.y + (i - (under ? 0 : (lines.length - 1) / 2)) * (under ? 19 : 16)));
      g.textAlign = 'left';
    }
  }

  private fitLines(lines: string[], w: number): string[] {
    const g = this.ctx;
    const out: string[] = [];
    for (const l of lines) {
      if (g.measureText(l).width <= w) { out.push(l); continue; }
      const words = l.split(' ');
      let cur = '';
      for (const wd of words) {
        const t = cur ? cur + ' ' + wd : wd;
        if (g.measureText(t).width > w && cur) { out.push(cur); cur = wd; } else cur = t;
      }
      if (cur) out.push(cur);
    }
    return out;
  }

  private drawTrayItem(cell: TrayCell): void {
    const g = this.ctx, P = this.painter, d = this.dpr;
    const it = cell.item;
    g.save();
    if (it.kind === 'chime') {
      const s = P.uprightChime(it.note);
      const k = Math.min((cell.h - 10) / 2.35, (cell.w - 8) / 0.8);
      const h = s.h * k, w = s.w * k;
      g.drawImage(s.img, cell.x + (cell.w - w) / 2, cell.y + cell.h - 5 - h, w, h);
    } else {
      const piece: Piece = it.kind === 'ramp' ? { kind: 'ramp', c: 0, r: 0, flip: false } : { kind: 'bell', c: 0, r: 0 };
      const sp = P.sprites(piece);
      if (it.kind === 'ramp') {
        // Laid level in the tray.
        const rg = rampGeo(0, 0, false);
        const cx = (rg.hx + rg.ex) / 2, cy = (rg.hy + rg.ey) / 2 - 0.25;
        const k = Math.min((cell.w - 6) / 7.0, (cell.h - 6) / 1.4);
        g.translate(cell.x + cell.w / 2, cell.y + cell.h / 2 + 0.1 * k); g.scale(k, k); g.rotate(-rg.angle); g.translate(-cx, -cy);
      } else {
        const box = { x0: -0.55, y0: -0.3, w: 1.1, h: 1.45 };
        const k = Math.min((cell.w - 8) / box.w, (cell.h - 8) / box.h);
        const ox = cell.x + (cell.w - box.w * k) / 2 - box.x0 * k, oy = cell.y + (cell.h - box.h * k) / 2 - box.y0 * k;
        g.translate(ox, oy); g.scale(k, k);
      }
      for (const s of [sp.back, sp.front]) if (s) g.drawImage(s.img, s.x0, s.y0, s.w, s.h);
    }
    g.restore();
    void d;
  }

  private drawHeld(): void {
    const h = this.held!;
    const g = this.ctx, d = this.dpr;
    h.lift = Math.min(1, h.lift + 0.2);
    const liftW = h.touch ? 0.9 * h.lift : 0;
    const ax = h.px + h.gx, ay = h.py + h.gy - liftW;
    h.vx = ax; h.vy = ay;
    g.setTransform(d * this.S, 0, 0, d * this.S, this.ox * d, this.oy * d);
    // Where it will settle: the pegs it will use light up, with a faint outline.
    if (h.target && !h.overTray) {
      g.save();
      g.globalAlpha = 0.28;
      const sp = this.painter.sprites(h.target);
      g.translate(h.target.c, h.target.r);
      g.drawImage(sp.back.img, sp.back.x0, sp.back.y0, sp.back.w, sp.back.h);
      if (sp.front) g.drawImage(sp.front.img, sp.front.x0, sp.front.y0, sp.front.w, sp.front.h);
      g.restore();
      for (const s of pieceShapes(h.target)) {
        if (!('circ' in s) || s.r > 0.25) continue;
        g.beginPath(); g.arc(s.circ[0], s.circ[1], 0.24, 0, Math.PI * 2);
        g.strokeStyle = BLUE; g.lineWidth = 0.07; g.stroke();
      }
    }
    const bad = h.overTray ? h.from >= 0 : h.problem !== 'ok';
    const pose: Pose = { p: h.piece, x: ax, y: ay, lift: 1, flipK: 1, rot: 0, alpha: 1 };
    this.drawPiece(pose, 'shadow', -1);
    if (bad && !h.overTray) {
      // Plainly not here: a warm red halo around the piece.
      g.save(); g.translate(ax, ay);
      g.strokeStyle = 'rgba(224,65,47,0.5)'; g.fillStyle = 'rgba(224,65,47,0.5)'; g.lineCap = 'round';
      for (const s of pieceShapes({ ...h.piece, c: 0, r: 0 } as Piece)) {
        if ('circ' in s) { if (s.r > 0.25) { g.beginPath(); g.arc(s.circ[0], s.circ[1], s.r + 0.1, 0, Math.PI * 2); g.fill(); } }
        else if (s.r >= 0.19) { const [x0, y0, x1, y1] = s.cap; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineWidth = (s.r + 0.1) * 2; g.stroke(); }
      }
      g.restore();
    }
    g.save();
    if (h.overTray) g.globalAlpha = 0.75;
    this.drawPiece(pose, 'back', -1);
    this.drawPiece(pose, 'front', -1);
    g.restore();
  }

  /** For tests and capture. */
  state() {
    return {
      code: encode(this.run.board),
      pieces: this.run.board.pieces.length,
      marbles: this.run.world.marbles.length,
      steps: this.run.world.steps,
      attract: this.attract,
      running: this.running,
      beat: this.beat,
      audio: this.sound.ctx ? this.sound.ctx.state : 'none',
      S: this.S, ox: this.ox, oy: this.oy,
      tray: this.tray.map((c) => ({ kind: c.item.kind, note: 'note' in c.item ? c.item.note : -1, x: c.x + c.w / 2, y: c.y + c.h / 2 })),
    };
  }

  /** Screen position (CSS px, relative to the canvas) of a piece's centre. */
  pieceCentre(i: number): [number, number] {
    const p = this.run.board.pieces[i];
    const [cx, cy] = centreOf(p);
    return this.toScreen(p.c + cx, p.r + cy);
  }
}

interface Pose { p: Piece; x: number; y: number; lift: number; flipK: number; rot: number; alpha: number; }

function rank(p: Piece): number { return p.kind === 'ramp' ? 0 : p.kind === 'chime' ? 1 : 2; }
