import { describe, it, expect, vi, beforeEach } from 'vitest';
import { KNOWN_SIGNATURES } from '../tiLogicVisualizer/tiSignatures';

/**
 * Counterpart to `v12DeprecationGuard.test.ts`: that one is about functions that
 * GO AWAY in v12, this one is about those that only exist FROM v12 on.
 *
 * Trigger (a colleague's finding, 2026-08-23): on an 11.8 server the completion offered
 * `ExecuteHttpRequest` — the suggestion produces exactly the compiler error it was
 * supposed to prevent.
 *
 * Backed by three independent sources (all live, 2026-08-23):
 *  1. tiFunctionExistenceProbe.js against 11.8: the call behind `IF(1=0)`
 *     comes back as `Aborted`, in every arity 0..4 and in both forms.
 *  2. Cubewise's function library lists them as `v12`. The cross-check ran too: NO
 *     function that compiles on 11.8 is listed there as v12-only.
 *  3. On the v12 test server all of them compile — with a witness, a counter-witness and
 *     the control `CellGetN` in the same measurement window.
 *
 * Addendum 2026-08-30: the list has grown from 9 to 24. The trigger was Bedrock 5,
 * whose code uses the JSON family in 75 of 97 processes — 13 functions that
 * we did not know at all, plus `ProcessExecutionInProgress` and `ReturnTableHandle`.
 * All 15 measured on both servers: `Aborted` on 11.8, clean on v12.
 *
 * On that occasion THREE wrong signatures stood out, and precisely through the
 * trap that point 3 warns about: `CancelJobs` was set to zero arguments (actually: 1..n),
 * `WaitForAllJobs`/`WaitForAnyJobs` to numeric job ids (actually: strings).
 * The existence probe takes its arguments from the signature and therefore reported
 * "does not exist on v12" for three functions that very much do exist.
 *
 * Point 3 carries the result: a mere "does not compile" can also be a wrongly
 * recorded signature. Only the counter-run separates "does not exist here" from
 * "we call it wrong" — and exactly that is where an intermediate step of this round
 * failed (TI accepts EVERY assignment to an unknown name and creates it
 * in the process, so a "Name = 0;" test proves nothing).
 */
const V12_ONLY = [
  // HTTP family — replacement for ExecuteCommand, which goes away in v12.
  'ExecuteHttpRequest', 'HttpResponseGetBody', 'HttpResponseGetHeader', 'HttpResponseGetStatusCode',
  // Job family — asynchronous execution only exists in v12.
  'CancelJobs', 'GetJobStatus', 'WaitForAllJobs', 'WaitForAnyJobs', 'WaitForInternalJobs',
  'ProcessExecutionInProgress',
  // JSON family — noticed on Bedrock 5 on 2026-08-30 and re-measured live.
  'StringToJson', 'JsonToString', 'JsonGet', 'JsonGetKey', 'JsonType', 'JsonSize',
  'JsonAdd', 'JsonReplace', 'JsonRemove', 'JsonMove', 'JsonPatch', 'JsonMergePatch', 'JsonDiff',
  // ODBC table access.
  'ReturnTableHandle',
];

describe('v12Only signature flags', () => {
  it('flags exactly the live-verified functions', () => {
    const flagged = [...KNOWN_SIGNATURES.values()].filter(s => s.v12Only).map(s => s.name).sort();
    expect(flagged).toEqual([...V12_ONLY].sort());
  });

  it('never flags a function as both v12Only and deprecatedInV12', () => {
    const both = [...KNOWN_SIGNATURES.values()].filter(s => s.v12Only && s.deprecatedInV12).map(s => s.name);
    expect(both).toEqual([]);
  });

  it('keeps them out of the rules editor allowlist — they are TI-only', () => {
    const rulesFlagged = [...KNOWN_SIGNATURES.values()].filter(s => s.v12Only && s.rulesOnly).map(s => s.name);
    expect(rulesFlagged).toEqual([]);
  });
});

// ── Native provider ─────────────────────────────────────────────────────────
let v12 = false;
vi.mock('../utils/v12Mode', () => ({
  isV12Active: () => v12,
  isV12FromServer: () => false,
}));
vi.mock('../tm1Client', () => ({ getConfig: () => undefined }));
// tm1Rest/ modules import tm1Rest/client directly; same doubles there (docs/architecture/import-rules.md).
vi.mock('../tm1Rest/client', async () => await import('../tm1Client'));
vi.mock('../providers/fetchNames', () => ({ fetchNames: async () => [] }));

/** Document without a word under the cursor → the provider returns the full list. */
const wordlessDoc = {
  uri: { fsPath: '' },
  getWordRangeAtPosition: () => undefined,
  getText: () => '',
} as unknown as import('vscode').TextDocument;
const anyPos = { line: 0, character: 0 } as unknown as import('vscode').Position;

describe('TiFunctionCompletionProvider — v12-only functions', () => {
  beforeEach(() => { v12 = false; });

  it('hides them while v12 is not active', async () => {
    const { TiFunctionCompletionProvider } = await import('../providers/tm1CompletionProvider');
    const labels = new Provider(TiFunctionCompletionProvider).labels();
    for (const name of V12_ONLY) expect(labels).not.toContain(name);
    // Cross-check: an ordinary TI function is still in it.
    expect(labels).toContain('CellGetN');
  });

  it('offers them once v12 is active', async () => {
    v12 = true;
    const { TiFunctionCompletionProvider } = await import('../providers/tm1CompletionProvider');
    const labels = new Provider(TiFunctionCompletionProvider).labels();
    for (const name of V12_ONLY) expect(labels).toContain(name);
  });

  it('switches with the mode without rebuilding the provider', async () => {
    const { TiFunctionCompletionProvider } = await import('../providers/tm1CompletionProvider');
    const p = new Provider(TiFunctionCompletionProvider);
    expect(p.labels()).not.toContain('ExecuteHttpRequest');
    v12 = true;
    expect(p.labels()).toContain('ExecuteHttpRequest');
  });
});

/** Thin wrapper so the three tests do not build the same scaffolding three times. */
class Provider {
  private readonly inst: { provideCompletionItems: (d: unknown, p: unknown) => Array<{ label: unknown }> };
  constructor(Ctor: new () => unknown) {
    this.inst = new Ctor() as typeof this.inst;
  }
  labels(): string[] {
    return this.inst.provideCompletionItems(wordlessDoc, anyPos).map(i => String(i.label));
  }
}
