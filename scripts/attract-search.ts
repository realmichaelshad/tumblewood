// Finds a chime move (board B) and then a ramp flip (board C) that both play well, for the attract loop.
import { Run } from '../src/sim/run.ts';
import { decode, encode, nearestFit, NOTES, placement, type Board, type Piece } from '../src/board/board.ts';

const base = decode(process.argv[2] || 'u1r01l46r0bc53d6ab38g64o72o84')!;
function play(b: Board, dx = 0) {
  const run = new Run(b);
  run.world.addMarble(b.cup + dx, -0.88);
  const seq: string[] = []; let tray = -1;
  for (let i = 0; i < 240 * 8 && tray < 0; i++) for (const e of run.advance(1)) {
    if (e.owner >= 0 && e.speed > 2.5) { const p = b.pieces[e.owner]; const s = p.kind === 'chime' ? NOTES[p.note].name : p.kind === 'bell' ? 'bell' : 'r' + e.owner; if (seq[seq.length - 1] !== s) seq.push(s); }
    if (e.tag === 'tray') tray = e.t;
  }
  return { seq: seq.join(' '), tray, n: seq.filter((s) => !s.startsWith('r')).length };
}
const ok = (b: Board, r: ReturnType<typeof play>) => r.tray > 0 && [-0.03, 0.03].every((d) => play(b, d).seq === r.seq);
const s0 = play(base).seq;
const res: [number, string, string, string, string][] = [];
base.pieces.forEach((p, i) => {
  if (p.kind !== 'chime') return;
  const rest = { ...base, pieces: base.pieces.filter((_, j) => j !== i) };
  for (let c = 0; c < 10; c++) for (let r = 1; r < 14; r++) for (const flip of [false, true]) {
    const q: Piece = { ...p, c, r, flip };
    if (placement(rest, q) !== 'ok') continue;
    const B = { ...base, pieces: base.pieces.map((x, j) => (j === i ? q : x)) };
    const rb = play(B);
    if (rb.seq === s0 || rb.n < 4 || !ok(B, rb)) continue;
    B.pieces.forEach((rp, k) => {
      if (rp.kind !== 'ramp') return;
      const restB = { ...B, pieces: B.pieces.filter((_, j) => j !== k) };
      const f = nearestFit(restB, { ...rp, flip: !rp.flip }, rp.c, rp.r, -1, 1);
      if (!f) return;
      const C = { ...B, pieces: B.pieces.map((x, j) => (j === k ? f : x)) };
      const rc = play(C);
      if (rc.seq === rb.seq || rc.n < 3 || !ok(C, rc)) return;
      res.push([rb.n + rc.n, encode(B), rb.seq, encode(C), rc.seq]);
    });
  }
});
res.sort((a, b) => b[0] - a[0]);
for (const r of res.slice(0, 20)) console.log(r.join(' | '));
