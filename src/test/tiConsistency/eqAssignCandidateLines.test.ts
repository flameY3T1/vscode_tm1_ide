import { describe, it, expect } from 'vitest';
import { eqAssignCandidateLines } from '../../tiConsistency/scanText';

describe('eqAssignCandidateLines', () => {
  it('counts single-= assignment/comparison candidates per line, whole-word, code-only', () => {
    const m = eqAssignCandidateLines("sX = 'a'; IF(sX = 'z'); sX = 'b';\nsY = sX;", 'sx');
    // line 1: three `sX =` candidates (two assigns + one comparison inside IF(...)).
    expect(m.get(1)).toBe(3);
    // line 2: `sY = sX;` — the only `sX` on the line is the RHS read, not
    // followed by '=' — zero candidates, so the line has no map entry.
    expect(m.get(2) ?? 0).toBe(0);
  });
});
