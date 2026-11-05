// src/test/helpers/confirmDialogDom.ts
//
// DOM double for everything that `_shared/confirmDialog.ts#askConfirm` touches.
//
// No jsdom/happy-dom in the repo (see `webviewClient/dimensionBrowserDragDrop.test.ts`,
// which builds a `classList` fake for the same reason). The dialog touches more than one
// attribute, so exactly its surface is here: createElement/appendChild/remove,
// attributes, `activeElement` + `focus()`, `contains()` and the document-wide
// capture listeners.
//
// What a double does NOT reproduce — and what is therefore deliberately in no test:
// the browser's real focus/tab order, `inert` as an effect (only as an
// attribute), `:focus` styling and Monaco's competing key handlers.
//
// Shared by `confirmDialogKeyboard.test.ts` (keyboard contract of the dialog itself)
// and `dimEditorConfirmFocus.test.ts` (the two adapters that call it).

type Listener = (e: unknown) => void;

export class FakeElement {
  public readonly tagName: string;
  public children: FakeElement[] = [];
  public parent: FakeElement | null = null;
  public textContent = '';
  public className = '';
  public id = '';
  public type = '';
  public readonly attrs = new Map<string, string>();
  public readonly classes = new Set<string>();
  public readonly listeners = new Map<string, Listener[]>();
  public focusCount = 0;

  public readonly classList = {
    add: (n: string): void => { this.classes.add(n); },
    remove: (n: string): void => { this.classes.delete(n); },
    contains: (n: string): boolean => this.classes.has(n),
  };

  constructor(tagName: string, private readonly doc: FakeDocument) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
  getAttribute(name: string): string | null { return this.attrs.has(name) ? (this.attrs.get(name) as string) : null; }
  hasAttribute(name: string): boolean { return this.attrs.has(name); }
  removeAttribute(name: string): void { this.attrs.delete(name); }

  appendChild(child: FakeElement): FakeElement {
    child.parent?.children.splice(child.parent.children.indexOf(child), 1);
    child.parent = this;
    this.children.push(child);
    return child;
  }

  remove(): void {
    this.parent?.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }

  contains(node: FakeElement | null): boolean {
    for (let n: FakeElement | null = node; n; n = n.parent) { if (n === this) { return true; } }
    return false;
  }

  focus(): void {
    this.focusCount += 1;
    this.doc.activeElement = this;
  }

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  /** Calls the listeners registered on THIS element (no bubbling needed). */
  fire(type: string, event: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) { fn(event); }
  }

  /** Rekursive Suche — `ensureStyle()` fragt `getElementById`. */
  findById(id: string): FakeElement | null {
    if (this.id === id) { return this; }
    for (const c of this.children) { const hit = c.findById(id); if (hit) { return hit; } }
    return null;
  }

  /** First element with this class, depth-first search. */
  findByClass(cls: string): FakeElement | null {
    if (this.className === cls || this.classes.has(cls)) { return this; }
    for (const c of this.children) { const hit = c.findByClass(cls); if (hit) { return hit; } }
    return null;
  }

  /** Alle Buttons unterhalb dieses Knotens, in Dokumentreihenfolge. */
  buttons(out: FakeElement[] = []): FakeElement[] {
    if (this.tagName === 'button') { out.push(this); }
    for (const c of this.children) { c.buttons(out); }
    return out;
  }
}

export class FakeDocument {
  public activeElement: FakeElement | null = null;
  public readonly head: FakeElement;
  public readonly body: FakeElement;
  private readonly capture = new Map<string, Listener[]>();

  constructor() {
    this.head = new FakeElement('head', this);
    this.body = new FakeElement('body', this);
  }

  createElement(tagName: string): FakeElement { return new FakeElement(tagName, this); }
  getElementById(id: string): FakeElement | null { return this.head.findById(id) ?? this.body.findById(id); }

  addEventListener(type: string, fn: Listener): void {
    const list = this.capture.get(type) ?? [];
    list.push(fn);
    this.capture.set(type, list);
  }

  removeEventListener(type: string, fn: Listener): void {
    const list = this.capture.get(type);
    if (!list) { return; }
    const i = list.indexOf(fn);
    if (i >= 0) { list.splice(i, 1); }
  }

  listenerCount(type: string): number { return (this.capture.get(type) ?? []).length; }

  dispatch(type: string, event: unknown): void {
    for (const fn of [...(this.capture.get(type) ?? [])]) { fn(event); }
  }
}

export interface FakeKeyEvent {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

export function keyEvent(key: string, shiftKey = false): FakeKeyEvent {
  const e: FakeKeyEvent = {
    key,
    shiftKey,
    defaultPrevented: false,
    preventDefault(): void { e.defaultPrevented = true; },
    stopPropagation(): void { /* im Double ohne Bubbling nichts zu tun */ },
  };
  return e;
}

/** Handle to an open dialog: answer promise + the nodes that tests touch. */
export interface OpenDialog {
  answer: Promise<boolean>;
  cancelBtn: FakeElement;
  okBtn: FakeElement;
  box: FakeElement;
  backdrop: FakeElement;
}

/**
 * Grabs the dialog most recently appended to the body.
 *
 * Throws if there is none — then the caller did not open the shared dialog at
 * all, and for the adapters that is exactly the statement of the test.
 */
export function grabDialog(doc: FakeDocument, answer: Promise<boolean>): OpenDialog {
  const backdrop = doc.body.children[doc.body.children.length - 1];
  if (!backdrop || backdrop.className !== 'tm1-confirm-backdrop') {
    throw new Error('Dialog wurde nicht in den Body gehängt');
  }
  const box = backdrop.children[0];
  const [cancelBtn, okBtn] = backdrop.buttons();
  return { answer, cancelBtn, okBtn, box, backdrop };
}

/** `'pending'` if the promise has not been resolved yet. */
export async function settledOrPending(p: Promise<boolean>): Promise<boolean | 'pending'> {
  return await Promise.race([p, Promise.resolve<'pending'>('pending')]);
}
