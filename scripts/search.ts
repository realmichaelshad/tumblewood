// Random search for a starter run: fixed ramps, chimes and bells placed to make a clean, robust phrase.
// node scripts/search.ts [evals] [seed]
import { Run } from '../src/sim/run.ts';
import { encode, placement, NOTES, type Board, type Piece } from '../src/board/board.ts';

const N = Number(process.argv[2] || 3000);
let seed = Number(process.argv[3] || 7);
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

const ramps: Piece[] = [
  { kind: 'ramp', c: 0, r: 1, flip: false },
  { kind: 'ramp', c: 4, r: 6, flip: true },
  { kind: 'ramp', c: 0, r: 11, flip: false },
];

function play(b: Board, dx = 0) {
  const run = new Run(b);
  run.world.addMarble(b.cup + dx, -0.88);
  const seq: number[] = []; const hits: { o: number; s: number; t: number }[] = [];
  let tray = -1;
  for (let i = 0; i < 240 * 7; i++) {
    for (const e of run.advance(1)) {
      if (e.owner >= 0) { hits.push({ o: e.owner, s: e.speed, t: e.t }); if (e.speed > 2 && seq[seq.length - 1] !== e.owner) seq.push(e.owner); }
      if (e.tag === 'tray' && tray < 0) tray = e.t;
    }
    if (tray > 0) break;
  }
  return { seq, hits, tray };
}

function score(b: Board) {
  const base = play(b);
  if (base.tray < 0) return { s: -100, base };
  let s = 0;
  const loud = new Set<number>();
  for (const h of base.hits) if (b.pieces[h.o].kind !== 'ramp' && h.s > 3) loud.add(h.o);
  const extras = b.pieces.filter((p) => p.kind !== 'ramp').length;
  s += loud.size * 4 - (extras - loud.size) * 6;
  for (const o of loud) if (b.pieces[o].kind === 'bell') s += 3;
  // Robust: the same sequence for small changes of the drop point.
  const key = base.seq.join(',');
  let same = 0;
  for (const d of [-0.04, -0.02, 0.02, 0.04]) if (play(b, d).seq.join(',') === key) same++;
  s += same * 2;
  if (base.tray > 5.5) s -= (base.tray - 5.5) * 4;
  // Ramps must all be used.
  for (let i = 0; i < ramps.length; i++) if (!base.seq.includes(i)) s -= 10;
  return { s, base };
}

import { decode } from '../src/board/board.ts';
const start = decode(process.argv[4] || 'u1r01l46r0bd53G69c48c74')!;
while (start.pieces.filter((p) => p.kind === 'bell').length < 2) { const p: Piece = { kind: 'bell', c: ri(0, 9), r: ri(2, 13) }; if (placement(start, p) === 'ok') start.pieces.push(p); }
let cur = { b: start, s: score(start).s };
console.log('start', cur.s, encode(start));
for (let k = 0; k < N; k++) {
  const b: Board = { cup: 1, pieces: cur.b.pieces.map((p) => ({ ...p })) };
  const idx = ri(3, b.pieces.length - 1);
  const p = b.pieces[idx];
  const m = ri(0, 4);
  const q = { ...p } as Piece;
  if (m === 0) q.c += ri(-1, 1);
  else if (m === 1) q.r += ri(-1, 1);
  else if (m === 2 && q.kind === 'chime') q.flip = !q.flip;
  else if (m === 3 && q.kind === 'chime') q.note = ri(0, 7);
  else { q.c = ri(0, 9); q.r = ri(2, 13); }
  const rest = { cup: 1, pieces: b.pieces.filter((_, j) => j !== idx) };
  if (placement(rest, q) !== 'ok') continue;
  b.pieces[idx] = q;
  const r = score(b);
  if (r.s >= cur.s) {
    if (r.s > cur.s) console.log(k, r.s.toFixed(1), encode(b), 'tray', r.base.tray.toFixed(2), r.base.seq.map((o) => { const pp = b.pieces[o]; return pp.kind === 'chime' ? NOTES[pp.note].name : pp.kind[0]; }).join(' '));
    cur = { b, s: r.s };
  }
}
console.log('final', cur.s, encode(cur.b));
