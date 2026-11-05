export interface UndoEntry {
  coordinates: string[];   // cube-dimension order element names
  oldValue: string;        // FormattedValue before edit (for rollback)
  newValue: string;        // FormattedValue submitted
  ri: number;              // row-index in current matrix (for UI re-target)
  ci: number;              // column-index
}

export interface UndoStack {
  push(e: UndoEntry): void;
  pop(): UndoEntry | undefined;
  peek(): UndoEntry | undefined;
  clear(): void;
  size(): number;
  isEmpty(): boolean;
}

export function createUndoStack(cap: number = 20): UndoStack {
  const buf: UndoEntry[] = [];
  return {
    push(e) {
      buf.push(e);
      while (buf.length > cap) buf.shift();
    },
    pop() { return buf.pop(); },
    peek() { return buf.length > 0 ? buf[buf.length - 1] : undefined; },
    clear() { buf.length = 0; },
    size() { return buf.length; },
    isEmpty() { return buf.length === 0; },
  };
}
