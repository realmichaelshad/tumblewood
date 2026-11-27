import { decode, type Board } from './board.ts';

/**
 * The run on the board when the page opens: three ramps, four chimes and two bells. A marble plays
 * E5, a bell, E5 again, D6, the second bell, then D5 and G5 on the way down. Found with scripts/search.ts
 * and kept because the phrase stays the same when the drop point moves a little.
 */
export const STARTER_CODE = 'u1r01l46r0bc53d6ab38g64o72o84';

export function starter(): Board {
  return decode(STARTER_CODE)!;
}

export const STARTER: Board = starter();
