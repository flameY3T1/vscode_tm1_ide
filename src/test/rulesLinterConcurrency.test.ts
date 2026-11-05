import { describe, it, expect } from 'vitest';
import { lintRulesServer, RULES_LINT_FETCH_CONCURRENCY } from '../tiLogicVisualizer/rulesLinter/lintServer';
import type { ApiRequestFn } from '../tiLogicVisualizer/rulesLinter';

/**
 * The rules linter derives its request list from server data (cube dimensions),
 * so an unbounded `Promise.all` lets a single Diagnostics run open one full
 * `Elements` load per dimension at once — against the shared extension host and
 * the TM1 server. These tests pin the fan-out width, not the lint result.
 */

/** Records how many `api` calls are in flight simultaneously. */
function trackingApi(body: (path: string) => string) {
  const state = { peak: 0, inFlight: 0, calls: [] as string[] };
  const api: ApiRequestFn = async (_method, path) => {
    state.inFlight++;
    state.peak = Math.max(state.peak, state.inFlight);
    state.calls.push(path);
    await new Promise((r) => setTimeout(r, 2));
    state.inFlight--;
    return { statusCode: 200, body: body(path) };
  };
  return { api, state };
}

const elementsBody = JSON.stringify({ value: [{ Name: 'E1' }] });

describe('lintRulesServer fan-out', () => {
  it('caps concurrent element loads when many dimensions are referenced', async () => {
    // 20 distinct dimensions → 20 `Elements` requests in the second fan.
    const refs = Array.from({ length: 20 }, (_, i) => `['Dim${i}':'E1']`).join(' + ');
    const rules = `['Target':'E1'] = N: ${refs};`;

    const { api, state } = trackingApi(() => elementsBody);
    await lintRulesServer(rules, api);

    expect(state.calls.length).toBeGreaterThan(RULES_LINT_FETCH_CONCURRENCY);
    expect(state.peak).toBe(RULES_LINT_FETCH_CONCURRENCY);
  });

  it('caps concurrent cube-dimension loads when many cubes are referenced', async () => {
    const calls = Array.from({ length: 20 }, (_, i) => `DB('Cube${i}', 'a', 'b')`).join(' + ');
    const rules = `['Target':'E1'] = N: ${calls};`;

    const { api, state } = trackingApi((path) =>
      path.includes('/Dimensions') ? JSON.stringify({ value: [{ Name: 'D1' }, { Name: 'D2' }] }) : elementsBody,
    );
    await lintRulesServer(rules, api);

    const cubeCalls = state.calls.filter((p) => p.includes('/Dimensions?'));
    expect(cubeCalls.length).toBe(20);
    expect(state.peak).toBe(RULES_LINT_FETCH_CONCURRENCY);
  });

  it('caps concurrent hierarchy loads for explicit Dim:Hier:Elem refs', async () => {
    const refs = Array.from({ length: 20 }, (_, i) => `['Dim${i}':'Hier${i}':'E1']`).join(' + ');
    const rules = `['Target':'E1'] = N: ${refs};`;

    const { api, state } = trackingApi((path) =>
      path.includes('/Hierarchies?') ? JSON.stringify({ value: [{ Name: 'Hier0' }] }) : elementsBody,
    );
    await lintRulesServer(rules, api);

    expect(state.peak).toBe(RULES_LINT_FETCH_CONCURRENCY);
  });

  it('still lints every referenced dimension despite the cap', async () => {
    const refs = Array.from({ length: 12 }, (_, i) => `['Dim${i}':'E1']`).join(' + ');
    const rules = `['Target':'E1'] = N: ${refs};`;

    const { api, state } = trackingApi(() => elementsBody);
    await lintRulesServer(rules, api);

    const elementCalls = state.calls.filter((p) => p.includes('/Elements?'));
    // 12 refs + the assignment target = 13 distinct dimensions, each loaded once.
    expect(new Set(elementCalls).size).toBe(elementCalls.length);
    expect(elementCalls.length).toBe(13);
  });
});
