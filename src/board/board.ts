// The board is data: a list of pieces on a pegboard grid. This file turns pieces into colliders and placement shapes,
// checks placement (in bounds, not overlapping), finds the nearest good place, encodes the board for a URL and
// prices the kit. Coordinates are in peg pitches (one inch on the real board); peg (c, r) sits at x = c, y = r.

import type { Collider } from '../sim/physics.ts';

export const COLS = 10;
export const ROWS = 15;
export const RAMP_SPAN = 5;
/** The board panel, in pitches. */
export const BOARD = { x0: -0.85, y0: -1.75, x1: COLS - 1 + 0.85, y1: ROWS - 1 + 0.95 };
/** Catch tray across the bottom. The floor leans a little to the right so marbles line up against the end. */
export const TRAY = { x0: -0.42, x1: COLS - 1 + 0.42, floorL: 14.1, floorR: 14.32, top: 13.42, wall: 0.1 };
export const CUP_Y = -1.0;

/** Pentatonic scale for the eight chimes, red (lowest, longest) to pink (highest, shortest). */
export const NOTES = [
  { name: 'C5', hz: 523.25, color: 'red' },
  { name: 'D5', hz: 587.33, color: 'orange' },
  { name: 'E5', hz: 659.26, color: 'yellow' },
  { name: 'G5', hz: 783.99, color: 'green' },
  { name: 'A5', hz: 880.0, color: 'teal' },
  { name: 'C6', hz: 1046.5, color: 'blue' },
  { name: 'D6', hz: 1174.66, color: 'purple' },
  { name: 'E6', hz: 1318.51, color: 'pink' },
] as const;

/** A free-free bar's pitch goes as 1 / length squared, so length goes as 1 / sqrt(pitch). */
export function chimeLength(note: number): number {
  return 1.95 * Math.sqrt(NOTES[0].hz / NOTES[note].hz);
}
export const CHIME_TILT = (15 * Math.PI) / 180;

export type Piece =
  | { kind: 'ramp'; c: number; r: number; flip: boolean }
  | { kind: 'chime'; c: number; r: number; flip: boolean; note: number }
  | { kind: 'bell'; c: number; r: number };

export interface Board {
  /** Column of the drop cup along the top edge. */
  cup: number;
  pieces: Piece[];
}

// ---------------------------------------------------------------- geometry

export interface RampGeo {
  /** Groove body capsule centre line, from the high end to where the drop slot starts. */
  hx: number; hy: number; sx: number; sy: number;
  /** Far (low) end of the ramp, past the slot. */
  ex: number; ey: number;
  /** Back block at the high end and stop block at the low end (vertical capsules). */
  wx: number; wy0: number; wy1: number;
  bx: number; by0: number; by1: number;
  /** Centre of the drop slot along the line. */
  slotX: number; slotY: number;
  pegs: [number, number][];
  angle: number;
  /** +1 when it runs down to the right. */
  dir: 1 | -1;
}

export const RAMP_BODY_R = 0.2;
export const RAMP_LIFT = 0.38;
export const RAMP_OVER = 0.45;
/** How far the ramp runs past its low peg: room for the drop slot and the stop block. */
export const RAMP_TAIL = 1.15;
export const WALL_R = 0.13;
export const SLOT = 0.78;

export function rampGeo(c: number, r: number, flip: boolean): RampGeo {
  const dir: 1 | -1 = flip ? -1 : 1;
  const left: [number, number] = [c, flip ? r + 1 : r];
  const right: [number, number] = [c + RAMP_SPAN, flip ? r : r + 1];
  const high = flip ? right : left, low = flip ? left : right;
  const dx = low[0] - high[0], dy = low[1] - high[1];
  const len = Math.hypot(dx, dy);
  const ux = dx / len, uy = dy / len;
  const hx = high[0] - ux * RAMP_OVER, hy = high[1] - RAMP_LIFT - uy * RAMP_OVER;
  const ex = low[0] + ux * RAMP_TAIL, ey = low[1] - RAMP_LIFT + uy * RAMP_TAIL;
  // Stop block sits at the very end; the slot opens between the groove's end and the block.
  const bx = ex - ux * 0.13, by1 = ey - uy * 0.13 + 0.06;
  const grooveEnd = 0.13 + WALL_R + SLOT + RAMP_BODY_R; // measured back from the end along the line
  const sx = ex - ux * grooveEnd, sy = ey - uy * grooveEnd;
  const mid = 0.13 + WALL_R + SLOT / 2;
  return {
    hx, hy, sx, sy, ex, ey,
    wx: hx + ux * 0.1, wy0: hy - 0.64, wy1: hy,
    bx, by0: by1 - 0.78, by1,
    slotX: ex - ux * mid, slotY: ey - uy * mid,
    pegs: [left, right], angle: Math.atan2(ey - hy, ex - hx), dir,
  };
}

export interface ChimeGeo { cx: number; cy: number; ax: number; ay: number; bx: number; by: number; len: number; angle: number; }
export const CHIME_R = 0.14;

export function chimeGeo(c: number, r: number, flip: boolean, note: number): ChimeGeo {
  const len = chimeLength(note);
  const ex = (Math.cos(CHIME_TILT) * len) / 2;
  const ey = ((flip ? -1 : 1) * Math.sin(CHIME_TILT) * len) / 2;
  // Left end first, so drawing always runs left to right. Not flipped: the right end is lower.
  return { cx: c, cy: r, ax: c - ex, ay: r - ey, bx: c + ex, by: r + ey, len, angle: Math.atan2(ey, ex) };
}

export interface BellGeo { px: number; py: number; dx: number; dy: number; domeR: number; lipY: number; lipHalf: number; }

export function bellGeo(c: number, r: number): BellGeo {
  return { px: c, py: r, dx: c, dy: r + 0.62, domeR: 0.26, lipY: r + 0.9, lipHalf: 0.34 };
}

export function pieceColliders(p: Piece, owner: number): Collider[] {
  if (p.kind === 'ramp') {
    const g = rampGeo(p.c, p.r, p.flip);
    return [
      { kind: 'cap', ax: g.hx, ay: g.hy, bx: g.sx, by: g.sy, r: RAMP_BODY_R, mat: 'wood', owner, tag: 'ramp' },
      { kind: 'cap', ax: g.wx, ay: g.wy0, bx: g.wx, by: g.wy1, r: WALL_R, mat: 'wood', owner, tag: 'ramp' },
      { kind: 'cap', ax: g.bx, ay: g.by0, bx: g.bx, by: g.by1, r: WALL_R, mat: 'wood', owner, tag: 'ramp' },
    ];
  }
  if (p.kind === 'chime') {
    const g = chimeGeo(p.c, p.r, p.flip, p.note);
    return [{ kind: 'cap', ax: g.ax, ay: g.ay, bx: g.bx, by: g.by, r: CHIME_R, mat: 'metal', owner, tag: 'chime' }];
  }
  const g = bellGeo(p.c, p.r);
  return [
    { kind: 'circ', x: g.dx, y: g.dy, r: g.domeR, mat: 'brass', owner, tag: 'bell' },
    { kind: 'cap', ax: g.dx - g.lipHalf, ay: g.lipY, bx: g.dx + g.lipHalf, by: g.lipY, r: 0.06, mat: 'brass', owner, tag: 'bell' },
  ];
}

export function trayColliders(): Collider[] {
  const t = TRAY;
  return [
    { kind: 'cap', ax: t.x0, ay: t.floorL + t.wall, bx: t.x1, by: t.floorR + t.wall, r: t.wall, mat: 'wood', owner: -1, tag: 'tray' },
    { kind: 'cap', ax: t.x0, ay: t.top, bx: t.x0, by: t.floorL + t.wall, r: t.wall, mat: 'wood', owner: -1, tag: 'tray' },
    { kind: 'cap', ax: t.x1, ay: t.top, bx: t.x1, by: t.floorR + t.wall, r: t.wall, mat: 'wood', owner: -1, tag: 'tray' },
  ];
}

export function boardColliders(b: Board): Collider[] {
  const out: Collider[] = [];
  b.pieces.forEach((p, i) => out.push(...pieceColliders(p, i)));
  out.push(...trayColliders());
  return out;
}

// ---------------------------------------------------------------- placement

type Shape = { cap: [number, number, number, number]; r: number } | { circ: [number, number]; r: number };

const PEG_R = 0.2;

export function pieceShapes(p: Piece): Shape[] {
  if (p.kind === 'ramp') {
    const g = rampGeo(p.c, p.r, p.flip);
    return [
      { cap: [g.hx, g.hy, g.ex, g.ey], r: 0.27 },
      { cap: [g.wx, g.wy0, g.wx, g.wy1], r: 0.15 },
      { cap: [g.bx, g.by0, g.bx, g.by1], r: 0.15 },
      ...g.pegs.map((q): Shape => ({ circ: q, r: PEG_R })),
    ];
  }
  if (p.kind === 'chime') {
    const g = chimeGeo(p.c, p.r, p.flip, p.note);
    return [{ cap: [g.ax, g.ay, g.bx, g.by], r: 0.2 }, { circ: [p.c, p.r], r: PEG_R }];
  }
  const g = bellGeo(p.c, p.r);
  return [
    { circ: [g.dx, g.dy], r: 0.4 },
    { cap: [g.dx - g.lipHalf, g.lipY, g.dx + g.lipHalf, g.lipY], r: 0.12 },
    { circ: [p.c, p.r], r: PEG_R },
  ];
}

function fixedShapes(cup: number): Shape[] {
  return [
    { circ: [cup, CUP_Y], r: 0.55 },
    { cap: [TRAY.x0, 13.95, TRAY.x1, 13.95], r: 0.5 },
  ];
}

function segDist2(ax: number, ay: number, bx: number, by: number, px: number, py: number): number {
  const ex = bx - ax, ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let s = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  s = s < 0 ? 0 : s > 1 ? 1 : s;
  const dx = px - (ax + ex * s), dy = py - (ay + ey * s);
  return dx * dx + dy * dy;
}

function segSegDist(a: number[], b: number[]): number {
  // Segments do not cross in practice for overlap purposes unless very close; endpoint distances plus a crossing test.
  if (segmentsCross(a, b)) return 0;
  return Math.sqrt(Math.min(
    segDist2(a[0], a[1], a[2], a[3], b[0], b[1]), segDist2(a[0], a[1], a[2], a[3], b[2], b[3]),
    segDist2(b[0], b[1], b[2], b[3], a[0], a[1]), segDist2(b[0], b[1], b[2], b[3], a[2], a[3]),
  ));
}

function segmentsCross(a: number[], b: number[]): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => Math.sign((qx - px) * (ry - py) - (qy - py) * (rx - px));
  const o1 = o(a[0], a[1], a[2], a[3], b[0], b[1]), o2 = o(a[0], a[1], a[2], a[3], b[2], b[3]);
  const o3 = o(b[0], b[1], b[2], b[3], a[0], a[1]), o4 = o(b[0], b[1], b[2], b[3], a[2], a[3]);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o3 !== 0;
}

function shapeDist(s: Shape, t: Shape): number {
  if ('circ' in s && 'circ' in t) return Math.hypot(s.circ[0] - t.circ[0], s.circ[1] - t.circ[1]);
  if ('circ' in s && 'cap' in t) return Math.sqrt(segDist2(t.cap[0], t.cap[1], t.cap[2], t.cap[3], s.circ[0], s.circ[1]));
  if ('cap' in s && 'circ' in t) return Math.sqrt(segDist2(s.cap[0], s.cap[1], s.cap[2], s.cap[3], t.circ[0], t.circ[1]));
  return segSegDist((s as { cap: number[] }).cap, (t as { cap: number[] }).cap);
}

function shapesOverlap(a: Shape[], b: Shape[]): boolean {
  for (const s of a) for (const t of b) if (shapeDist(s, t) < s.r + t.r) return true;
  return false;
}

function inBounds(shapes: Shape[]): boolean {
  const x0 = BOARD.x0 + 0.12, x1 = BOARD.x1 - 0.12, y0 = BOARD.y0 + 0.1, y1 = BOARD.y1 - 0.1;
  for (const s of shapes) {
    const pts = 'circ' in s ? [s.circ] : [[s.cap[0], s.cap[1]], [s.cap[2], s.cap[3]]];
    for (const [x, y] of pts) if (x - s.r < x0 || x + s.r > x1 || y - s.r < y0 || y + s.r > y1) return false;
  }
  return true;
}

export type Problem = 'ok' | 'outside' | 'overlap';

/** Why a piece cannot go where it is (or 'ok'). `skip` is the index of the piece itself when it is being moved. */
export function placement(b: Board, p: Piece, skip = -1): Problem {
  if (!Number.isInteger(p.c) || !Number.isInteger(p.r)) return 'outside';
  if (p.c < 0 || p.c >= COLS || p.r < 0 || p.r >= ROWS) return 'outside';
  const shapes = pieceShapes(p);
  if (!inBounds(shapes)) return 'outside';
  if (shapesOverlap(shapes, fixedShapes(b.cup))) return 'overlap';
  for (let i = 0; i < b.pieces.length; i++) {
    if (i === skip) continue;
    if (shapesOverlap(shapes, pieceShapes(b.pieces[i]))) return 'overlap';
  }
  return 'ok';
}

/** The nearest grid anchor to (fc, fr) where the piece fits, searching outward; null if nothing within `reach`. */
export function nearestFit(b: Board, p: Piece, fc: number, fr: number, skip = -1, reach = 6): Piece | null {
  const cands: [number, number, number][] = [];
  const c0 = Math.round(fc), r0 = Math.round(fr);
  for (let dc = -reach; dc <= reach; dc++) {
    for (let dr = -reach; dr <= reach; dr++) {
      const c = c0 + dc, r = r0 + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue;
      cands.push([(c - fc) ** 2 + (r - fr) ** 2, c, r]);
    }
  }
  // Stable order: by distance, then row, then column, so ties always resolve the same way.
  cands.sort((a, b2) => a[0] - b2[0] || a[2] - b2[2] || a[1] - b2[1]);
  for (const [, c, r] of cands) {
    const q = { ...p, c, r } as Piece;
    if (placement(b, q, skip) === 'ok') return q;
  }
  return null;
}

/** Where the cup may sit: any column whose cup area is clear. */
export function cupFits(b: Board, c: number): boolean {
  if (c < 0 || c >= COLS) return false;
  const s: Shape[] = [{ circ: [c, CUP_Y], r: 0.55 }];
  return b.pieces.every((p) => !shapesOverlap(s, pieceShapes(p)));
}

// ---------------------------------------------------------------- the URL

const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';
const CH_R = 'abcdefgh', CH_L = 'ABCDEFGH';

export function encode(b: Board): string {
  let s = 'u' + B36[b.cup];
  for (const p of b.pieces) {
    const pos = B36[p.c] + B36[p.r];
    if (p.kind === 'ramp') s += (p.flip ? 'l' : 'r') + pos;
    else if (p.kind === 'chime') s += (p.flip ? CH_L : CH_R)[p.note] + pos;
    else s += 'o' + pos;
  }
  return s;
}

/** Decode a board string. Unknown tokens and pieces that would overlap are dropped, so a bad link still loads. */
export function decode(s: string): Board | null {
  if (!/^u[0-9a-z]([rloa-hA-H][0-9a-z]{2})*$/.test(s)) return null;
  const b: Board = { cup: B36.indexOf(s[1]), pieces: [] };
  if (b.cup >= COLS) b.cup = 0;
  for (let i = 2; i + 2 < s.length + 1; i += 3) {
    const k = s[i], c = B36.indexOf(s[i + 1]), r = B36.indexOf(s[i + 2]);
    let p: Piece;
    if (k === 'r' || k === 'l') p = { kind: 'ramp', c, r, flip: k === 'l' };
    else if (k === 'o') p = { kind: 'bell', c, r };
    else if (CH_R.includes(k)) p = { kind: 'chime', c, r, flip: false, note: CH_R.indexOf(k) };
    else p = { kind: 'chime', c, r, flip: true, note: CH_L.indexOf(k) };
    if (placement(b, p) === 'ok' && b.pieces.length < MAX_PIECES) b.pieces.push(p);
  }
  return b;
}

export const MAX_PIECES = 30;

// ---------------------------------------------------------------- the kit

export const PRICES = { base: 48, ramp: 6, chime: 9, bell: 7 };
export const MARBLES_IN_KIT = 12;

export interface Kit {
  ramps: number;
  chimes: number;
  bells: number;
  pegs: number;
  /** Chime notes on the board, low to high (repeats kept). */
  notes: number[];
  lines: { label: string; qty: number; each: number; total: number }[];
  total: number;
}

export function kitOf(b: Board): Kit {
  let ramps = 0, chimes = 0, bells = 0;
  const notes: number[] = [];
  for (const p of b.pieces) {
    if (p.kind === 'ramp') ramps++;
    else if (p.kind === 'bell') bells++;
    else { chimes++; notes.push(p.note); }
  }
  notes.sort((a, c) => a - c);
  const pegs = ramps * 2 + chimes + bells;
  const lines = [
    { label: 'base', qty: 1, each: PRICES.base, total: PRICES.base },
    { label: 'ramp', qty: ramps, each: PRICES.ramp, total: ramps * PRICES.ramp },
    { label: 'chime', qty: chimes, each: PRICES.chime, total: chimes * PRICES.chime },
    { label: 'bell', qty: bells, each: PRICES.bell, total: bells * PRICES.bell },
  ];
  return { ramps, chimes, bells, pegs, notes, lines, total: lines.reduce((s, l) => s + l.total, 0) };
}
