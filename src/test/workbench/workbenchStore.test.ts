import { describe, it, expect, beforeEach, vi } from 'vitest';
import { upsertWorkbench, MAX_WINDOWS, MAX_WORKBENCHES, type Workbench } from '../../commands/workbench/workbenchStorePure';
import { WorkbenchStore } from '../../commands/workbench/workbenchStore';
import { purgeWorkbenchesForServer } from '../../commands/workbench/workbenchPurge';

// ============================================================================
// Pure function tests
// ============================================================================

const wb = (over: Partial<Workbench> = {}): Workbench => ({
	id: 'w1',
	serverId: 'http://s',
	name: 'Quartal',
	savedAt: 1,
	windows: [],
	...over,
});

describe('upsertWorkbench', () => {
	it('adds new workbench', () => {
		expect(upsertWorkbench([], wb())).toHaveLength(1);
	});

	it('replaces by id, keeping list length', () => {
		const out = upsertWorkbench([wb()], wb({ name: 'Neu' }));
		expect(out).toHaveLength(1);
		expect(out[0].name).toBe('Neu');
	});

	it('keeps unknown kind values', () => {
		const saved = wb({ windows: [{ kind: 'unknown', target: 'foo', state: { x: 1 } }] });
		const updated = upsertWorkbench([saved], wb({ name: 'Updated', windows: [{ kind: 'unknown', target: 'foo', state: { x: 1 } }] }));
		expect(updated[0].windows).toHaveLength(1);
		expect(updated[0].windows[0]).toStrictEqual({ kind: 'unknown', target: 'foo', state: { x: 1 } });
	});

	it('caps windows at MAX_WINDOWS', () => {
		const tooMany = wb({ windows: Array.from({ length: MAX_WINDOWS + 5 }, (_, i) => ({ kind: 'cube', target: `c${i}` })) });
		const out = upsertWorkbench([], tooMany);
		expect(out[0].windows).toHaveLength(MAX_WINDOWS);
	});

	// ── Cap per server ─────────────────────────────────────────────────
	// The window cap only limits ONE workbench; the number of workbenches
	// was unlimited, even though every save rewrites the whole key.

	const many = (n: number, serverId = 'http://s') =>
		Array.from({ length: n }, (_, i) => wb({ id: `w${i}`, serverId, name: `W${i}`, savedAt: i + 1 }));

	it('keeps exactly MAX_WORKBENCHES per server', () => {
		const out = upsertWorkbench(many(MAX_WORKBENCHES), wb({ id: 'neu', savedAt: 999 }));
		expect(out).toHaveLength(MAX_WORKBENCHES);
	});

	it('evicts the OLDEST workbench when the cap is exceeded', () => {
		const out = upsertWorkbench(many(MAX_WORKBENCHES), wb({ id: 'neu', savedAt: 999 }));
		expect(out.find(w => w.id === 'w0')).toBeUndefined();   // savedAt 1 = oldest
		expect(out.find(w => w.id === 'w1')).toBeDefined();
		expect(out.find(w => w.id === 'neu')).toBeDefined();
	});

	it('does not cap as long as the cap is not exceeded', () => {
		const out = upsertWorkbench(many(MAX_WORKBENCHES - 1), wb({ id: 'neu', savedAt: 999 }));
		expect(out).toHaveLength(MAX_WORKBENCHES);
		expect(out.find(w => w.id === 'w0')).toBeDefined();
	});

	it('leaves the workbenches of OTHER servers untouched', () => {
		const fremd = many(3, 'http://andere').map(w => ({ ...w, id: `x${w.id}`, savedAt: 0 }));
		const out = upsertWorkbench([...fremd, ...many(MAX_WORKBENCHES)], wb({ id: 'neu', savedAt: 999 }));
		// Only the own server is capped — the three foreign ones stay, even though
		// their `savedAt` is the oldest of all.
		expect(out.filter(w => w.serverId === 'http://andere')).toHaveLength(3);
		expect(out.filter(w => w.serverId === 'http://s')).toHaveLength(MAX_WORKBENCHES);
	});

	it('never evicts the workbench just written, not even with an old timestamp', () => {
		// Renaming keeps the old `savedAt` — otherwise renaming the oldest
		// workbench would delete itself.
		const bestand = many(MAX_WORKBENCHES + 3);
		const out = upsertWorkbench(bestand, wb({ id: 'w0', name: 'Umbenannt', savedAt: 1 }));
		expect(out).toHaveLength(MAX_WORKBENCHES);
		expect(out.find(w => w.id === 'w0')?.name).toBe('Umbenannt');
	});

	it('returns shallow copy, not same array', () => {
		const original = [wb()];
		const updated = upsertWorkbench(original, wb({ id: 'w2' }));
		expect(original).not.toBe(updated);
		expect(original).toHaveLength(1);
		expect(updated).toHaveLength(2);
	});
});

// ============================================================================
// WorkbenchStore integration tests
// ============================================================================

function makeCtx() {
	const store = new Map<string, any>();
	return {
		globalState: {
			get: <T,>(k: string, fallback?: T) => (store.has(k) ? store.get(k) : fallback),
			update: vi.fn((k: string, v: any) => { store.set(k, v); return Promise.resolve(); }),
		},
	} as any;
}

describe('WorkbenchStore', () => {
	let ctx: ReturnType<typeof makeCtx>;
	let store: WorkbenchStore;

	beforeEach(() => {
		ctx = makeCtx();
		store = new WorkbenchStore(ctx);
	});

	describe('round-trip with unknown kind (forward compatibility)', () => {
		it('preserves unknown kind values when read back', async () => {
			// Save a workbench with a future-unknown kind
			const wb1 = wb({
				id: 'future1',
				serverId: 'http://server',
				name: 'Future Workbench',
				windows: [
					{ kind: 'fromTheFuture', target: 'someTarget', state: { custom: true } },
				],
			});
			await store.save(wb1);

			// Read back through a FRESH store instance over same memento
			// (this tests the read path validates structure but NOT kind values)
			const store2 = new WorkbenchStore(ctx);
			const retrieved = store2.get('future1');

			expect(retrieved).toBeDefined();
			expect(retrieved?.windows).toHaveLength(1);
			expect(retrieved?.windows[0].kind).toBe('fromTheFuture');
			expect(retrieved?.windows[0].target).toBe('someTarget');
			expect(retrieved?.windows[0].state).toStrictEqual({ custom: true });
		});
	});

	describe('list', () => {
		it('returns workbenches for a server, sorted by savedAt descending', async () => {
			await store.save(wb({ id: 'w1', serverId: 'http://a', name: 'A', savedAt: 100 }));
			await store.save(wb({ id: 'w2', serverId: 'http://a', name: 'B', savedAt: 300 }));
			await store.save(wb({ id: 'w3', serverId: 'http://a', name: 'C', savedAt: 200 }));
			await store.save(wb({ id: 'w4', serverId: 'http://b', name: 'D', savedAt: 400 }));

			const list = store.list('http://a');
			expect(list).toHaveLength(3);
			expect(list[0].name).toBe('B'); // savedAt 300
			expect(list[1].name).toBe('C'); // savedAt 200
			expect(list[2].name).toBe('A'); // savedAt 100
		});
	});

	describe('get', () => {
		it('returns undefined for missing id', () => {
			expect(store.get('missing')).toBeUndefined();
		});

		it('returns saved workbench by id', async () => {
			const original = wb({ id: 'test1', name: 'Test' });
			await store.save(original);
			expect(store.get('test1')?.name).toBe('Test');
		});
	});

	describe('rename', () => {
		it('updates workbench name', async () => {
			await store.save(wb({ id: 'r1', name: 'Old' }));
			await store.rename('r1', 'New');
			expect(store.get('r1')?.name).toBe('New');
		});

		it('is no-op for missing id', async () => {
			await store.rename('missing', 'New');
			expect(ctx.globalState.update).not.toHaveBeenCalled();
		});
	});

	describe('remove', () => {
		it('deletes workbench by id', async () => {
			await store.save(wb({ id: 'del1' }));
			expect(store.get('del1')).toBeDefined();
			await store.remove('del1');
			expect(store.get('del1')).toBeUndefined();
		});

		it('leaves other workbenches untouched', async () => {
			await store.save(wb({ id: 'keep1' }));
			await store.save(wb({ id: 'del1' }));
			await store.remove('del1');
			expect(store.get('keep1')).toBeDefined();
		});
	});

	// ── Broken persistence ─────────────────────────────────────────────
	// `globalState` is writable from outside (sync, manual editing, older
	// version). The read path filters, but had never been tested against anything
	// other than correct objects.

	describe('broken globalState', () => {
		it('returns [] instead of throwing when no array is stored there', () => {
			const raw = makeCtx();
			raw.globalState.update('tm1.workbenches.v1', 'kaputt');
			const s = new WorkbenchStore(raw);
			expect(s.list('http://s')).toEqual([]);
			expect(s.get('w1')).toBeUndefined();
		});

		it('drops an entry without savedAt instead of passing it through', () => {
			const raw = makeCtx();
			raw.globalState.update('tm1.workbenches.v1', [
				{ id: 'gut', serverId: 'http://s', name: 'Gut', savedAt: 1, windows: [] },
				{ id: 'halb', serverId: 'http://s', name: 'Halb', windows: [] },
			]);
			const s = new WorkbenchStore(raw);
			expect(s.list('http://s').map(w => w.id)).toEqual(['gut']);
			expect(s.get('halb')).toBeUndefined();
		});
	});

	// The payload stays unchecked here because there is NONE: the store holds
	// a `vscode.EventEmitter<void>` and calls `fire()` without an argument
	// (`workbenchStore.ts`). This checks everything the event
	// states — THAT something changed. Whoever later gives it a payload
	// (such as the affected `id`) must check it here as well.
	describe('onDidChange event', () => {
		it('fires after save', async () => {
			const handler = vi.fn();
			store.onDidChange(handler);
			await store.save(wb({ id: 'evt1' }));
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('fires after remove', async () => {
			await store.save(wb({ id: 'evt2' }));
			const handler = vi.fn();
			store.onDidChange(handler);
			await store.remove('evt2');
			expect(handler).toHaveBeenCalledTimes(1);
		});

		it('fires after rename', async () => {
			await store.save(wb({ id: 'evt3' }));
			const handler = vi.fn();
			store.onDidChange(handler);
			await store.rename('evt3', 'Renamed');
			expect(handler).toHaveBeenCalledTimes(1);
		});
	});
});

/**
 * The shape check reaches into the windows.
 *
 * Until 2026-08-25 `_isValidWorkbench` only checked `Array.isArray(w.windows)`,
 * not the elements. A `null` or `"abc"` in it makes `kind.label(w)` in
 * `restoreFlow.ts` fail with a TypeError — in the middle of the
 * `withProgress` chain and uncaught, so the WHOLE
 * restore run aborts instead of reporting this one window
 * (review 2026-08-24, H4).
 *
 * Unknown `kind` VALUES remain explicitly allowed: that is the
 * forward compatibility the module header promises. What is checked is the
 * SHAPE, not the meaning.
 */
describe('WorkbenchStore: shape check of the windows', () => {
	let ctx: ReturnType<typeof makeCtx>;
	let store: WorkbenchStore;

	beforeEach(() => {
		ctx = makeCtx();
		store = new WorkbenchStore(ctx);
	});

	/** Inject raw content past the store — that is how it also arrives from outside. */
	function lege(rohe: unknown[]): void {
		ctx.globalState.update('tm1.workbenches.v1', rohe);
	}

	it.each([
		['null in the window array', [null]],
		['a string instead of a window', ['abc']],
		['a number instead of a window', [42]],
		['a window without kind', [{ target: 'X' }]],
		['kind is not a string', [{ kind: 7 }]],
	])('rejects a workbench with %s', (_name, windows) => {
		lege([{ ...wb({ id: 'kaputt' }), windows }]);
		expect(store.get('kaputt')).toBeUndefined();
		expect(store.list('http://s')).toHaveLength(0);
	});

	it('lets unknown kind values through — the shape is fine after all', () => {
		lege([{ ...wb({ id: 'zukunft' }), windows: [{ kind: 'ausDerZukunft', target: 'X' }] }]);
		expect(store.get('zukunft')?.windows[0].kind).toBe('ausDerZukunft');
	});

	it('lets a window without target and without state through — both are optional', () => {
		lege([{ ...wb({ id: 'schlank' }), windows: [{ kind: 'tm1.cubeViewer' }] }]);
		expect(store.get('schlank')?.windows).toHaveLength(1);
	});

	it('a broken workbench does NOT drag the healthy ones down with it', () => {
		lege([
			{ ...wb({ id: 'kaputt' }), windows: [null] },
			{ ...wb({ id: 'heil' }), windows: [{ kind: 'tm1.cubeViewer', target: 'C' }] },
		]);
		expect(store.get('heil')?.windows).toHaveLength(1);
		expect(store.list('http://s').map(w => w.id)).toEqual(['heil']);
	});
});


// ============================================================================
// purgeWorkbenchesForServer
// ============================================================================
//
// `Workbench.serverId` IS the profile ID. If someone deletes the server profile,
// no view points to these entries anymore — but they stayed permanently in
// `globalState`, invisible and undeletable, because the cap
// (`MAX_WORKBENCHES`) counts per `serverId` and therefore never reaches the
// orphaned stock (review 2026-08-24, H4).
//
// Deliberately a free function and not a method: `deleteServer` only gets the
// `ExtensionContext` passed, not the `WorkbenchStore` instance from
// `extension.ts`. That is why an `onDidChange` is missing here — `deleteServer`
// fires `onServerChanged` anyway, and the server node together with its workbench
// children disappears with it.

describe('purgeWorkbenchesForServer', () => {
	let ctx: ReturnType<typeof makeCtx>;
	let store: WorkbenchStore;

	beforeEach(() => {
		ctx = makeCtx();
		store = new WorkbenchStore(ctx);
	});

	it('removes all workbenches of the server and reports the count', async () => {
		await store.save(wb({ id: 'a', serverId: 'weg' }));
		await store.save(wb({ id: 'b', serverId: 'weg' }));
		expect(await purgeWorkbenchesForServer(ctx, 'weg')).toBe(2);
		expect(store.list('weg')).toEqual([]);
	});

	it('leaves other servers untouched', async () => {
		await store.save(wb({ id: 'a', serverId: 'weg' }));
		await store.save(wb({ id: 'b', serverId: 'bleibt' }));
		await purgeWorkbenchesForServer(ctx, 'weg');
		expect(store.list('bleibt').map(w => w.id)).toEqual(['b']);
	});

	it('does not write at all without matches', async () => {
		await store.save(wb({ id: 'a', serverId: 'bleibt' }));
		ctx.globalState.update.mockClear();
		expect(await purgeWorkbenchesForServer(ctx, 'nie-dagewesen')).toBe(0);
		expect(ctx.globalState.update).not.toHaveBeenCalled();
	});

	it('copes with empty and broken globalState', async () => {
		expect(await purgeWorkbenchesForServer(makeCtx(), 'weg')).toBe(0);
		const kaputt = makeCtx();
		kaputt.globalState.update('tm1.workbenches.v1', 'kaputt');
		kaputt.globalState.update.mockClear();
		expect(await purgeWorkbenchesForServer(kaputt, 'weg')).toBe(0);
		expect(kaputt.globalState.update).not.toHaveBeenCalled();
	});

	// The module header promises forward compatibility: an older
	// program version must not lose foreign entries. Purging counts
	// only what it understands itself — but writes back the RAW list minus the
	// matched entries, so that a structurally foreign entry
	// of another server survives the operation.
	it('writes foreign entries of other servers back', async () => {
		const roh = makeCtx();
		roh.globalState.update('tm1.workbenches.v1', [
			{ id: 'a', serverId: 'weg', name: 'A', savedAt: 1, windows: [] },
			{ id: 'x', serverId: 'bleibt', zukunftsformat: true },
		]);
		expect(await purgeWorkbenchesForServer(roh, 'weg')).toBe(1);
		const nachher = roh.globalState.get('tm1.workbenches.v1') as unknown[];
		expect(nachher).toEqual([{ id: 'x', serverId: 'bleibt', zukunftsformat: true }]);
	});

	it('also removes structurally broken entries of THIS server', async () => {
		const roh = makeCtx();
		roh.globalState.update('tm1.workbenches.v1', [
			{ id: 'kaputt', serverId: 'weg', windows: null },
			{ id: 'heil', serverId: 'weg', name: 'H', savedAt: 1, windows: [] },
		]);
		await purgeWorkbenchesForServer(roh, 'weg');
		expect(roh.globalState.get('tm1.workbenches.v1')).toEqual([]);
	});
});
