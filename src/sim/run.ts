// A run: one board, its physics world and the drop schedule. Used by the page, the tests and the attract loop.
import { World, type HitEvent } from './physics.ts';
import { boardColliders, CUP_Y, TRAY, type Board } from '../board/board.ts';

/** One marble every 1.6 seconds when "Keep dropping" is on (384 steps at 240 Hz). */
export const BEAT_STEPS = 384;
export const MAX_MARBLES = 18;

export class Run {
  world = new World();
  board: Board;
  /** Step index of the next automatic drop, or -1 when not dropping on the beat. */
  nextDrop = -1;

  constructor(board: Board) {
    this.board = board;
    this.world.trayY = TRAY.top + 0.05;
    this.rebuild();
  }

  setBoard(b: Board): void {
    this.board = b;
    this.rebuild();
  }

  /** Pieces that are in the hand (being moved) and so not on the board. */
  lifted = new Set<number>();

  /** Colliders follow the board, minus anything lifted. */
  rebuild(): void {
    this.world.colliders = boardColliders(this.board).filter((c) => c.owner < 0 || !this.lifted.has(c.owner));
  }

  drop(): boolean {
    const live = this.world.marbles.filter((m) => m.fade < 0).length;
    if (live >= MAX_MARBLES) return false;
    this.world.addMarble(this.board.cup, CUP_Y + 0.12);
    return true;
  }

  /** Start dropping on the beat (the first marble goes now) or stop. */
  setBeat(on: boolean): void {
    this.nextDrop = on ? this.world.steps : -1;
  }

  step(): void {
    if (this.nextDrop >= 0 && this.world.steps >= this.nextDrop) {
      this.drop();
      this.nextDrop += BEAT_STEPS;
    }
    this.world.step();
  }

  /** Run n steps and return the hit events (for tests and tuning). */
  advance(n: number): HitEvent[] {
    const out: HitEvent[] = [];
    for (let i = 0; i < n; i++) { this.step(); out.push(...this.world.takeEvents()); }
    return out;
  }
}
