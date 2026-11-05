import { describe, expect, it } from 'vitest';
import {
  buildDropText,
  buildExecuteProcessWithParams,
  escTi,
  isDraggable,
  type DragSource,
  type ProcessParamRef,
} from '../providers/tm1TreeDragDropPure';

const mk = (nodeType: string, meta: Record<string, unknown> = {}, label?: string): DragSource => ({
  nodeType, meta, label,
});

describe('tm1TreeDragDropPure', () => {
  describe('escTi', () => {
    it('passes plain strings unchanged', () => {
      expect(escTi('Sales')).toBe('Sales');
    });
    it("doubles single quotes per TI/OData convention", () => {
      expect(escTi("Bob's Cube")).toBe("Bob''s Cube");
    });
    it('handles multiple quotes', () => {
      expect(escTi("a'b'c")).toBe("a''b''c");
    });
  });

  describe('isDraggable', () => {
    it.each(['process', 'chore', 'cube', 'dimension'])('accepts %s', (t) => {
      expect(isDraggable(mk(t))).toBe(true);
    });

    it.each(['view', 'subset', 'attribute', 'thread', 'serverRoot', 'category'])('rejects %s', (t) => {
      expect(isDraggable(mk(t))).toBe(false);
    });
  });

  describe('buildDropText', () => {
    it('process → ExecuteProcess(...)', () => {
      expect(buildDropText(mk('process', { processName: 'LoadSales' }))).toBe(
        "ExecuteProcess('LoadSales');",
      );
    });
    it('chore → ExecuteChore(...)', () => {
      expect(buildDropText(mk('chore', { choreName: 'NightlyBatch' }))).toBe(
        "ExecuteChore('NightlyBatch');",
      );
    });
    it('cube → single-quoted name', () => {
      expect(buildDropText(mk('cube', { cubeName: 'Sales' }))).toBe("'Sales'");
    });
    it('dimension → single-quoted name', () => {
      expect(buildDropText(mk('dimension', { dimName: 'Time' }))).toBe("'Time'");
    });

    it('falls back to label when meta key missing', () => {
      expect(buildDropText(mk('cube', {}, 'FallbackCube'))).toBe("'FallbackCube'");
      expect(buildDropText(mk('process', {}, 'FallbackProc'))).toBe("ExecuteProcess('FallbackProc');");
    });

    it('handles label as object form (vscode.TreeItemLabel)', () => {
      expect(buildDropText(mk('cube', {}, { label: 'ObjCube' } as any))).toBe("'ObjCube'");
    });

    it('escapes single quotes in names', () => {
      expect(buildDropText(mk('process', { processName: "Sync'd" }))).toBe(
        "ExecuteProcess('Sync''d');",
      );
    });

    it('returns empty string for non-draggable types', () => {
      expect(buildDropText(mk('view'))).toBe('');
      expect(buildDropText(mk('thread'))).toBe('');
    });
  });

  describe('buildExecuteProcessWithParams', () => {
    const numP: ProcessParamRef = { Name: 'pYear', Type: 'Numeric' };
    const strP: ProcessParamRef = { Name: 'pCube', Type: 'String' };

    it('renders single-arg form when no params', () => {
      expect(buildExecuteProcessWithParams('Proc', [])).toBe("ExecuteProcess('Proc');");
    });

    it('numeric param without outer match → defaults to 0', () => {
      expect(buildExecuteProcessWithParams('Proc', [numP])).toBe(
        "ExecuteProcess('Proc',\n    'pYear', 0\n);",
      );
    });

    it('string param without outer match → defaults to empty string literal', () => {
      expect(buildExecuteProcessWithParams('Proc', [strP])).toBe(
        "ExecuteProcess('Proc',\n    'pCube', ''\n);",
      );
    });

    it('matches outer param case-insensitive, preserves outer casing', () => {
      const out = buildExecuteProcessWithParams('Proc', [numP], ['PYEAR']);
      expect(out).toBe("ExecuteProcess('Proc',\n    'pYear', PYEAR\n);");
    });

    it('mixes matched + unmatched + multiple types', () => {
      const out = buildExecuteProcessWithParams(
        'MyProc',
        [{ Name: 'a', Type: 'Numeric' }, { Name: 'b', Type: 'String' }],
        ['a'],
      );
      expect(out).toBe("ExecuteProcess('MyProc',\n    'a', a,\n    'b', ''\n);");
    });

    it('escapes single quotes in process + param names', () => {
      const out = buildExecuteProcessWithParams(
        "Bob's",
        [{ Name: "x'y", Type: 'String' }],
      );
      expect(out).toBe("ExecuteProcess('Bob''s',\n    'x''y', ''\n);");
    });
  });
});
