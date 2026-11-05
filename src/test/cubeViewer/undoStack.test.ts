import { describe, it, expect } from 'vitest';
import { createUndoStack, type UndoEntry } from '../../cubeViewer/undoStack';

function entry(i: number): UndoEntry {
  return { coordinates: [`d${i}`], oldValue: String(i - 1), newValue: String(i), ri: i, ci: 0 };
}

describe('undoStack', () => {
  it('starts empty', () => {
    const s = createUndoStack();
    expect(s.size()).toBe(0);
    expect(s.isEmpty()).toBe(true);
    expect(s.pop()).toBeUndefined();
  });

  it('push + pop LIFO', () => {
    const s = createUndoStack();
    s.push(entry(1));
    s.push(entry(2));
    expect(s.size()).toBe(2);
    expect(s.pop()?.newValue).toBe('2');
    expect(s.pop()?.newValue).toBe('1');
    expect(s.pop()).toBeUndefined();
  });

  it('caps at 20 — oldest entry is discarded', () => {
    const s = createUndoStack(20);
    for (let i = 1; i <= 25; i++) s.push(entry(i));
    expect(s.size()).toBe(20);
    // Last-in (entry 25) still on top, entries 1..5 dropped
    expect(s.pop()?.newValue).toBe('25');
    // Drain the rest — newest first
    let remaining = 19;
    let expected = 24;
    while (remaining-- > 0) {
      expect(s.pop()?.newValue).toBe(String(expected--));
    }
    expect(s.pop()).toBeUndefined();
    // After full drain, oldest we ever saw was 6 (1..5 dropped)
    expect(expected).toBe(5);
  });

  it('respects custom cap', () => {
    const s = createUndoStack(3);
    s.push(entry(1));
    s.push(entry(2));
    s.push(entry(3));
    s.push(entry(4));
    expect(s.size()).toBe(3);
    expect(s.pop()?.newValue).toBe('4');
    expect(s.pop()?.newValue).toBe('3');
    expect(s.pop()?.newValue).toBe('2');
    expect(s.pop()).toBeUndefined();
  });

  it('clear() empties the stack', () => {
    const s = createUndoStack();
    s.push(entry(1)); s.push(entry(2));
    s.clear();
    expect(s.size()).toBe(0);
    expect(s.isEmpty()).toBe(true);
  });

  it('peek() returns newest without popping', () => {
    const s = createUndoStack();
    s.push(entry(1)); s.push(entry(2));
    expect(s.peek()?.newValue).toBe('2');
    expect(s.size()).toBe(2);
  });
});
