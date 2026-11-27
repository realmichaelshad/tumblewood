import { describe, expect, it } from 'vitest';
import { World, MATERIALS, type Capsule } from '../src/sim/physics.ts';
import { Run } from '../src/sim/run.ts';
import { starter } from '../src/board/starter.ts';
import { decode, encode, nearestFit, type Board, type Piece } from '../src/board/board.ts';

function slope(deg: number, mat: Capsule['mat'] = 'metal'): { w: World; cap: Capsule; ux: number; uy: number } {
  const w = new World();
  const a = (deg * Math.PI) / 180;
  const ux = Math.cos(a), uy = Math.sin(a);
  const cap: Capsule = { kind: 'cap', ax: 0, ay: 0, bx: 40 * ux, by: 40 * uy, r: 0.1, mat, owner: 0, tag: 'test' };
  w.colliders = [cap];
  return { w, cap, ux, uy };
}

function seat(w: World, cap: Capsule, s: number, ux: number, uy: number) {
  // Resting on the surface, s pitches along it.
  const nx = uy, ny = -ux; // outward normal (up)
  const d = cap.r + w.o.radius + 1e-4;
  return w.addMarble(cap.ax + ux * s + nx * d, cap.ay + uy * s + ny * d);
}

describe('rolling on a slope', () => {
  it('reaches the speed of a rolling solid sphere, not a sliding one', () => {
    for (const deg of [8, 15, 25]) {
      const { w, cap, ux, uy } = slope(deg);
      const m = seat(w, cap, 1, ux, uy);
      const x0 = m.x, y0 = m.y;
      for (let i = 0; i < 240; i++) w.step();
      const dist = Math.hypot(m.x - x0, m.y - y0);
      const v = Math.hypot(m.vx, m.vy);
      const g = w.o.gravity, a = (deg * Math.PI) / 180;
      // a = 5/7 g sin(theta), minus a little rolling resistance.
      const ideal = Math.sqrt(2 * ((5 / 7) * g * Math.sin(a) - MATERIALS.metal.roll) * dist);
      expect(Math.abs(v - ideal) / ideal).toBeLessThan(0.02);
      const sliding = Math.sqrt(2 * g * Math.sin(a) * dist);
      expect(v).toBeLessThan(sliding * 0.9);
      // It rolls: spin matches speed.
      expect(Math.abs(Math.abs(m.w) * w.o.radius - v) / v).toBeLessThan(0.02);
    }
  });

  it('stays on the surface while rolling', () => {
    const { w, cap, ux, uy } = slope(12, 'wood');
    const m = seat(w, cap, 1, ux, uy);
    for (let i = 0; i < 480; i++) {
      w.step();
      const s = (m.x - cap.ax) * ux + (m.y - cap.ay) * uy;
      const h = (m.x - cap.ax) * uy - (m.y - cap.ay) * ux;
      expect(s).toBeGreaterThan(0);
      expect(h).toBeGreaterThan(cap.r + w.o.radius - 1e-3);
      expect(h).toBeLessThan(cap.r + w.o.radius + 1e-2);
    }
  });
});

describe('energy', () => {
  function checkBoard(b: Board, seconds: number) {
    const run = new Run(b);
    run.drop();
    const w = run.world;
    let e = w.energy(w.marbles[0]);
    let steps = 0;
    for (let i = 0; i < seconds * 240 && w.marbles.length; i++) {
      run.step();
      const m = w.marbles[0];
      if (!m) break;
      const e2 = w.energy(m);
      expect(e2).toBeLessThanOrEqual(e + 1e-9);
      e = e2;
      steps++;
    }
    return steps;
  }

  it('never grows on the starter run', () => {
    expect(checkBoard(starter(), 8)).toBeGreaterThan(240 * 3);
  });

  it('never grows on random boards', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let k = 0; k < 12; k++) {
      const b: Board = { cup: Math.floor(rnd() * 10), pieces: [] };
      for (let t = 0; t < 60 && b.pieces.length < 12; t++) {
        const r = rnd();
        const p: Piece = r < 0.35 ? { kind: 'ramp', c: 0, r: 0, flip: rnd() < 0.5 } : r < 0.8 ? { kind: 'chime', c: 0, r: 0, flip: rnd() < 0.5, note: Math.floor(rnd() * 8) } : { kind: 'bell', c: 0, r: 0 };
        const q = nearestFit(b, p, rnd() * 10, 1 + rnd() * 12, -1, 1);
        if (q) b.pieces.push(q);
      }
      checkBoard(b, 6);
    }
  });

  it('bounces higher off metal than off wood', () => {
    const heights: Record<string, number> = {};
    for (const mat of ['wood', 'metal'] as const) {
      const w = new World();
      w.colliders = [{ kind: 'cap', ax: -5, ay: 5, bx: 5, by: 5, r: 0.1, mat, owner: 0, tag: 't' }];
      const m = w.addMarble(0, 0);
      let hit = false, top = Infinity;
      for (let i = 0; i < 480; i++) {
        w.step();
        if (w.takeEvents().length) hit = true;
        if (hit && m.vy < 0) top = Math.min(top, m.y);
      }
      heights[mat] = 5 - 0.1 - 0.3 - top;
    }
    const drop = 5 - 0.4;
    expect(heights.metal / drop).toBeCloseTo(MATERIALS.metal.e ** 2, 1);
    expect(heights.wood / drop).toBeCloseTo(MATERIALS.wood.e ** 2, 1);
    expect(heights.metal).toBeGreaterThan(heights.wood * 2);
  });
});

describe('fast marbles', () => {
  it('cannot pass through a thin chime bar at any speed', () => {
    for (const speed of [20, 80, 200, 600]) {
      const w = new World({ gravity: 0, minX: -20 });
      w.colliders = [{ kind: 'cap', ax: 0, ay: -1, bx: 0, by: 1, r: 0.1, mat: 'metal', owner: 0, tag: 'chime' }];
      const m = w.addMarble(-3, 0.2, speed, 0);
      for (let i = 0; i < 240; i++) w.step();
      expect(m.x).toBeLessThan(0);
      expect(m.vx).toBeLessThan(0);
      expect(w.takeEvents().length).toBe(1);
    }
  });

  it('finds the hit on a ramp when dropped from very high', () => {
    const w = new World();
    w.colliders = [{ kind: 'cap', ax: -3, ay: 0, bx: 3, by: 0.6, r: 0.2, mat: 'wood', owner: 0, tag: 'ramp' }];
    const m = w.addMarble(0, -2, 0, 500);
    w.step(); w.step();
    expect(m.y).toBeLessThan(0.3);
    expect(m.vy).toBeLessThanOrEqual(0);
  });
});

describe('determinism', () => {
  function tune(b: Board) {
    const run = new Run(b);
    run.setBeat(true);
    const ev = run.advance(240 * 20);
    return { ev: ev.map((e) => [e.t, e.owner, e.tag, e.speed, e.x, e.y]), marbles: run.world.marbles.map((m) => [m.x, m.y, m.vx, m.vy, m.w]) };
  }

  it('plays the same tune every time for the same board and drops', () => {
    const a = tune(starter());
    // Something else in between must not change it.
    tune(decode('u4r01d33o61')!);
    const b = tune(decode(encode(starter()))!);
    expect(a.ev.length).toBeGreaterThan(40);
    expect(b).toEqual(a);
  });

  it('the starter run plays its phrase and ends in the tray', () => {
    const b = starter();
    const run = new Run(b);
    run.drop();
    const ev = run.advance(240 * 6).filter((e) => e.speed > 2 && e.owner >= 0 && b.pieces[e.owner].kind !== 'ramp');
    const seq: string[] = [];
    for (const e of ev) {
      const p = b.pieces[e.owner];
      const s = p.kind === 'chime' ? `chime${p.note}` : 'bell';
      if (seq[seq.length - 1] !== s) seq.push(s);
    }
    expect(seq.slice(0, 7)).toEqual(['chime2', 'bell', 'chime2', 'chime6', 'bell', 'chime1', 'chime3']);
    const m = run.world.marbles[0];
    expect(m.y).toBeGreaterThan(13.4);
  });
});

import { attractStep, CYCLE_STEPS } from '../src/attract.ts';

describe('attract loop', () => {
  it('repeats (to a millionth of a peg pitch), so a recorded loop has no jump', () => {
    const run = new Run(starter());
    const snap = () => run.world.marbles.map((m) => [m.x, m.y, m.vx, m.vy, m.fade]).flat();
    const same = (p: number[], q: number[]) => { expect(q.length).toBe(p.length); p.forEach((v, i) => expect(Math.abs(v - q[i])).toBeLessThan(1e-6)); };
    const cycle = () => { for (let s = 0; s < CYCLE_STEPS; s++) { attractStep(run, s); run.step(); run.world.takeEvents(); } };
    // The page plays two cycles silently first; after that every cycle ends exactly where it began.
    cycle(); cycle();
    const a = snap();
    cycle();
    const b = snap();
    cycle();
    const c = snap();
    same(a, b);
    same(a, c);
    expect(run.board.pieces).toEqual(starter().pieces);
  });
});
