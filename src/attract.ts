// Attract mode: a 12 second script the page performs by itself. The starter run plays with a marble every 1.2 s,
// then the D5 chime is picked up and hung low on the right (the tune loses its last two notes), then the middle ramp
// is turned the other way so the marble takes a new path and finds that chime again, then both go back.
// Everything is keyed to simulation steps, so the loop is exactly the same every time.

import type { Piece } from './board/board.ts';
import type { Run } from './sim/run.ts';

export const CYCLE_STEPS = 2880; // 12 s at 240 Hz
const S = (sec: number) => Math.round(sec * 240);

export const DROPS = [0, 1.2, 2.4, 3.6, 4.8, 6.0, 10.8].map(S);

export interface Move {
  piece: number;
  from: Piece;
  to: Piece;
  /** Lift and set-down steps. */
  lift: number;
  set: number;
  /** A visible fingertip: when it arrives and leaves (seconds), and whether it is a tap. */
  finger?: { in: number; out: number; tap: boolean };
}

// Indices into the starter board (see starter.ts): 1 is the middle ramp, 5 the D5 chime.
export const MOVES: Move[] = [
  { piece: 5, from: { kind: 'chime', c: 3, r: 8, flip: false, note: 1 }, to: { kind: 'chime', c: 8, r: 11, flip: true, note: 1 }, lift: S(4.1), set: S(4.9), finger: { in: 3.75, out: 5.25, tap: false } },
  { piece: 1, from: { kind: 'ramp', c: 4, r: 6, flip: true }, to: { kind: 'ramp', c: 3, r: 6, flip: false }, lift: S(6.1), set: S(6.5), finger: { in: 5.7, out: 6.45, tap: true } },
  { piece: 5, from: { kind: 'chime', c: 8, r: 11, flip: true, note: 1 }, to: { kind: 'chime', c: 3, r: 8, flip: false, note: 1 }, lift: S(9.6), set: S(10.4) },
  { piece: 1, from: { kind: 'ramp', c: 3, r: 6, flip: false }, to: { kind: 'ramp', c: 4, r: 6, flip: true }, lift: S(9.6), set: S(10.4) },
];

/** Apply whatever the script does at this step of the cycle (call before run.step()). Returns true if the board changed. */
export function attractStep(run: Run, cycleStep: number): boolean {
  let changed = false;
  for (const m of MOVES) {
    if (cycleStep === m.lift) { run.lifted.add(m.piece); changed = true; }
    if (cycleStep === m.set) {
      run.board.pieces[m.piece] = { ...m.to } as Piece;
      run.lifted.delete(m.piece);
      changed = true;
    }
  }
  if (changed) run.rebuild();
  if (DROPS.includes(cycleStep)) run.drop();
  return changed;
}

/** Where a moving piece is drawn: 0..1 progress with an eased arc, and how high it is lifted. */
export function movePose(m: Move, step: number): { k: number; lift: number } | null {
  if (step < m.lift || step >= m.set) return null;
  const t = (step - m.lift) / (m.set - m.lift);
  const k = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return { k, lift: Math.sin(Math.PI * t) };
}
