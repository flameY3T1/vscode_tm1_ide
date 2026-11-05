import * as vscode from 'vscode';
import { upsertWorkbench, type Workbench } from './workbenchStorePure';
import { STATE_KEY } from './workbenchPurge';

/**
 * The key lives in the leaf module `workbenchPurge.ts`, because
 * `deleteServer` needs it and an import of THIS file from there would pull
 * a cycle back to `serverManager` (via `workbenchStorePure` →
 * `windowKinds` → `cubeViewer/manager`).
 *
 * `v1` in the key: a later format gets a NEW key, instead of overwriting
 * the old one. Unknown `kind` values are not filtered out when loading —
 * anyone who opens an older program version should not lose their
 * workbench.
 */

export type { Workbench } from './workbenchStorePure';
export { MAX_WINDOWS } from './workbenchStorePure';

export class WorkbenchStore {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  public readonly onDidChange = this._onDidChange.event;

  constructor(private readonly context: vscode.ExtensionContext) {}

  private _all(): Workbench[] {
    const raw = this.context.globalState.get<unknown>(STATE_KEY);
    if (!Array.isArray(raw)) {
      return [];
    }
    // Validate only the structure, not the `kind` VALUES
    return raw.filter(w => this._isValidWorkbench(w));
  }

  private _isValidWorkbench(w: unknown): w is Workbench {
    return (
      typeof w === 'object' &&
      w !== null &&
      typeof (w as any).id === 'string' &&
      typeof (w as any).serverId === 'string' &&
      typeof (w as any).name === 'string' &&
      typeof (w as any).savedAt === 'number' &&
      Array.isArray((w as any).windows) &&
      // All the way down into the windows: a `null` or `"abc"` in the array
      // lets `kind.label(w)` in `restoreFlow` fail with a TypeError —
      // previously in the middle of the `withProgress` chain and uncaught,
      // so the ENTIRE restore run aborted (review 2026-08-24, H4).
      ((w as any).windows as unknown[]).every(x => this._isValidWindow(x))
    );
  }

  /**
   * The SHAPE of a window, not its meaning.
   *
   * `kind` must be a string, because `kindOf` uses it as a key. `target`
   * and `state` are optional and stay unchecked: `state` belongs to the
   * respective window kind, and a check here would be a second place that
   * knows its contract. Unknown `kind` VALUES remain explicitly allowed —
   * that is the forward compatibility the module header promises.
   */
  private _isValidWindow(x: unknown): boolean {
    return typeof x === 'object' && x !== null && typeof (x as any).kind === 'string';
  }

  list(serverId: string): Workbench[] {
    return this._all()
      .filter(w => w.serverId === serverId)
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  get(id: string): Workbench | undefined {
    return this._all().find(w => w.id === id);
  }

  async save(wb: Workbench): Promise<void> {
    await this.context.globalState.update(STATE_KEY, upsertWorkbench(this._all(), wb));
    this._onDidChange.fire();
  }

  async rename(id: string, name: string): Promise<void> {
    const wb = this.get(id);
    if (!wb) {
      return;
    }
    await this.save({ ...wb, name });
  }

  async remove(id: string): Promise<void> {
    await this.context.globalState.update(STATE_KEY, this._all().filter(w => w.id !== id));
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}
