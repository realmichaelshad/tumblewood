import { describe, expect, it } from 'vitest';
import { chimeLength, cupFits, decode, encode, kitOf, nearestFit, NOTES, placement, PRICES, type Board, type Piece } from '../src/board/board.ts';
import { starter, STARTER_CODE } from '../src/board/starter.ts';

describe('the board as data', () => {
  it('round-trips through the link format', () => {
    const b = starter();
    expect(encode(b)).toBe(STARTER_CODE);
    expect(decode(encode(b))).toEqual(b);
    // Short: three characters a piece.
    expect(encode(b).length).toBe(2 + 3 * b.pieces.length);
  });

  it('rejects garbage and drops pieces that would overlap', () => {
    expect(decode('')).toBeNull();
    expect(decode('hello')).toBeNull();
    expect(decode('u1r01zz')).toBeNull();
    // The same ramp twice: the second one cannot go there.
    const b = decode('u1r01r01c63')!;
    expect(b.pieces.map((p) => p.kind)).toEqual(['ramp', 'chime']);
  });
});

describe('placement', () => {
  const b = starter();
  it('accepts every piece of the starter where it is', () => {
    b.pieces.forEach((p, i) => expect(placement(b, p, i)).toBe('ok'));
  });

  it('refuses a piece on top of another, on the same peg, or off the board', () => {
    const onRamp: Piece = { kind: 'chime', c: 2, r: 1, flip: false, note: 0 };
    expect(placement(b, onRamp)).toBe('overlap');
    const samePeg: Piece = { kind: 'bell', c: 7, r: 2 };
    expect(placement(b, samePeg)).toBe('overlap');
    expect(placement(b, { kind: 'ramp', c: 7, r: 12, flip: false })).toBe('outside');
    expect(placement(b, { kind: 'bell', c: -1, r: 3 })).toBe('outside');
    expect(placement(b, { kind: 'bell', c: 2.5, r: 3 })).toBe('outside');
  });

  it('refuses the tray and the drop cup', () => {
    expect(placement(b, { kind: 'bell', c: 4, r: 13 })).toBe('overlap');
    expect(placement(b, { kind: 'bell', c: 1, r: 0 })).not.toBe('ok');
  });

  it('settles a dropped piece in the nearest good place', () => {
    const p: Piece = { kind: 'chime', c: 0, r: 0, flip: false, note: 0 };
    // Dropped right on top of the first ramp.
    const q = nearestFit(b, p, 2.2, 1.1)!;
    expect(q).not.toBeNull();
    expect(placement(b, q)).toBe('ok');
    const d = Math.hypot(q.c - 2.2, q.r - 1.1);
    // Nothing closer fits.
    for (let c = 0; c < 10; c++) for (let r = 0; r < 15; r++) {
      if (Math.hypot(c - 2.2, r - 1.1) < d - 1e-9) expect(placement(b, { ...p, c, r })).not.toBe('ok');
    }
    // A free spot is used as it is.
    expect(nearestFit(b, p, 8.1, 9.2)).toMatchObject({ c: 8, r: 9 });
    // Same input, same answer.
    expect(nearestFit(b, p, 2.2, 1.1)).toEqual(q);
  });

  it('snaps a moved piece without counting itself as in the way', () => {
    const i = b.pieces.findIndex((p) => p.kind === 'bell');
    const p = b.pieces[i];
    expect(nearestFit(b, p, p.c + 0.3, p.r - 0.2, i)).toMatchObject({ c: p.c, r: p.r });
  });

  it('lets the cup slide only where it is clear', () => {
    expect(cupFits(b, 1)).toBe(true);
    expect(cupFits(b, 10)).toBe(false);
    const high: Board = { cup: 0, pieces: [{ kind: 'ramp', c: 4, r: 0, flip: true }] };
    expect(cupFits(high, 9)).toBe(false); // the back block of a top-row ramp is there
    expect(cupFits(high, 1)).toBe(true);
  });
});

describe('the kit', () => {
  it('counts the pieces and prices them', () => {
    const k = kitOf(starter());
    expect([k.ramps, k.chimes, k.bells]).toEqual([3, 4, 2]);
    expect(k.pegs).toBe(3 * 2 + 4 + 2);
    expect(k.total).toBe(PRICES.base + 3 * PRICES.ramp + 4 * PRICES.chime + 2 * PRICES.bell);
    expect(k.notes).toEqual([1, 2, 3, 6]);
  });

  it('follows the board', () => {
    const b: Board = { cup: 1, pieces: [] };
    expect(kitOf(b).total).toBe(PRICES.base);
    b.pieces.push({ kind: 'chime', c: 5, r: 5, flip: false, note: 7 }, { kind: 'chime', c: 5, r: 8, flip: true, note: 7 });
    const k = kitOf(b);
    expect(k.chimes).toBe(2);
    expect(k.notes).toEqual([7, 7]);
    expect(k.total).toBe(PRICES.base + 2 * PRICES.chime);
  });
});

describe('chimes', () => {
  it('get shorter as they get higher, as a real bar does (length goes as one over the square root of pitch)', () => {
    for (let i = 1; i < 8; i++) expect(chimeLength(i)).toBeLessThan(chimeLength(i - 1));
    const ratio = chimeLength(0) / chimeLength(7);
    expect(ratio).toBeCloseTo(Math.sqrt(NOTES[7].hz / NOTES[0].hz), 6);
  });
});
