import { describe, it, expect } from 'vitest';
import {
  Tm1TreeDragDropController,
  buildDropText,
  buildExecuteProcessWithParams,
} from '../../providers/tm1TreeDragDrop';
import { DataTransfer, DataTransferItem } from '../__mocks__/vscode';
import type { Tm1TreeNode } from '../../providers/tm1TreeNodes';

function node(nodeType: string, label: string, meta?: Record<string, unknown>): Tm1TreeNode {
  return { nodeType, label, meta } as unknown as Tm1TreeNode;
}

describe('buildDropText', () => {
  it('process node -> ExecuteProcess() with meta.processName preferred', () => {
    expect(buildDropText(node('process', 'L', { processName: 'MyProc' })))
      .toBe("ExecuteProcess('MyProc');");
  });

  it('process node -> falls back to label when meta missing', () => {
    expect(buildDropText(node('process', 'FallbackProc')))
      .toBe("ExecuteProcess('FallbackProc');");
  });

  it('chore node -> ExecuteChore()', () => {
    expect(buildDropText(node('chore', 'X', { choreName: 'NightlyJob' })))
      .toBe("ExecuteChore('NightlyJob');");
  });

  it('cube node -> string literal', () => {
    expect(buildDropText(node('cube', 'X', { cubeName: 'SalesCube' })))
      .toBe("'SalesCube'");
  });

  it('dimension node -> string literal with meta.dimName', () => {
    expect(buildDropText(node('dimension', 'X', { dimName: 'Region' })))
      .toBe("'Region'");
  });

  it('escapes single quotes by doubling', () => {
    expect(buildDropText(node('process', 'L', { processName: "O'Brien" })))
      .toBe("ExecuteProcess('O''Brien');");
  });

  it('returns empty string for unknown nodeType', () => {
    expect(buildDropText(node('other', 'X'))).toBe('');
  });
});

describe('buildExecuteProcessWithParams', () => {
  it('no params -> simple ExecuteProcess call', () => {
    expect(buildExecuteProcessWithParams('MyProc', [])).toBe("ExecuteProcess('MyProc');");
  });

  it('numeric param without outer-match -> default 0', () => {
    expect(buildExecuteProcessWithParams('P', [{ Name: 'pCount', Type: 'Numeric' }]))
      .toBe("ExecuteProcess('P',\n    'pCount', 0\n);");
  });

  it('string param without outer-match -> default ""', () => {
    expect(buildExecuteProcessWithParams('P', [{ Name: 'pName', Type: 'String' }]))
      .toBe("ExecuteProcess('P',\n    'pName', ''\n);");
  });

  it('outer-param match -> variable reference (preserves casing)', () => {
    const result = buildExecuteProcessWithParams(
      'P',
      [{ Name: 'pcube', Type: 'String' }],
      ['pCube'],
    );
    expect(result).toBe("ExecuteProcess('P',\n    'pcube', pCube\n);");
  });

  it('escapes single quotes in process name + param name', () => {
    const result = buildExecuteProcessWithParams("Test'Proc", [{ Name: "p'Name", Type: 'String' }]);
    expect(result).toBe("ExecuteProcess('Test''Proc',\n    'p''Name', ''\n);");
  });

  it('mix of matched and unmatched outer params', () => {
    const result = buildExecuteProcessWithParams(
      'P',
      [
        { Name: 'pYear', Type: 'Numeric' },
        { Name: 'pUnused', Type: 'String' },
      ],
      ['pYear'],
    );
    expect(result).toBe("ExecuteProcess('P',\n    'pYear', pYear,\n    'pUnused', ''\n);");
  });
});

describe('Tm1TreeDragDropController.handleDrag', () => {
  it('writes drop text into dataTransfer for first draggable node', () => {
    const controller = new Tm1TreeDragDropController();
    const dt = new DataTransfer();
    controller.handleDrag([node('process', 'X', { processName: 'P1' })] as never, dt as never);
    expect(dt.get('text/plain')).toBeDefined();
    expect((dt.get('text/plain') as DataTransferItem).value).toBe("ExecuteProcess('P1');");
  });

  it('writes nothing when no node is draggable', () => {
    const controller = new Tm1TreeDragDropController();
    const dt = new DataTransfer();
    controller.handleDrag([node('server', 'X')] as never, dt as never);
    expect(dt.get('text/plain')).toBeUndefined();
  });

  it('handleDrag selects first draggable when sources include non-draggable nodes', () => {
    const controller = new Tm1TreeDragDropController();
    const dt = new DataTransfer();
    controller.handleDrag(
      [node('server', 'X'), node('cube', 'X', { cubeName: 'C' })] as never,
      dt as never,
    );
    expect((dt.get('text/plain') as DataTransferItem).value).toBe("'C'");
  });

  it('exposes correct MIME types', () => {
    const controller = new Tm1TreeDragDropController();
    expect(controller.dragMimeTypes).toEqual(['text/plain']);
    expect(controller.dropMimeTypes).toEqual([]);
  });
});
