import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { TiFoldingProvider, RulesFoldingProvider } from '../../providers/tiFoldingProvider';

const doc = (text: string) => ({ getText: () => text }) as any;

describe('TiFoldingProvider', () => {
  it('maps #Region block 0-based Region fold', () => {
    const text = ['#Region setup', 'x = 1;', 'y = 2;', '#EndRegion'].join('\n');
    const r = new TiFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 3, vscode.FoldingRangeKind.Region));
  });

  it('maps IF block 0-based unspecified fold', () => {
    const text = ['IF(x > 0);', 'y = 1;', 'ENDIF;'].join('\n');
    const r = new TiFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 2));
  });

  it('maps WHILE block 0-based unspecified fold', () => {
    const text = ['WHILE(x > 0);', 'x = x - 1;', 'END;'].join('\n');
    const r = new TiFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 2));
  });
});

describe('RulesFoldingProvider', () => {
  it('maps rules #Region block 0-based Region fold', () => {
    const text = ['#Region setup', '#SKIPCHECK;', '#EndRegion'].join('\n');
    const r = new RulesFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Region));
  });

  it('maps rules SKIPCHECK/FEEDERS block 0-based Region fold', () => {
    const text = ['SKIPCHECK;', 'x = 1;', 'FEEDERS;', 'db -> 1;', 'ENDFEEDERS;'].join('\n');
    const r = new RulesFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 1, vscode.FoldingRangeKind.Region)); // SKIPCHECK section
    expect(r).toContainEqual(new vscode.FoldingRange(2, 4, vscode.FoldingRangeKind.Region)); // FEEDERS section
  });

  it('maps a comment run to a Comment fold', () => {
    const text = ['# header 1', '# header 2', '# header 3', `['a'] = N: 1;`].join('\n');
    const r = new RulesFoldingProvider().provideFoldingRanges(doc(text));
    expect(r).toContainEqual(new vscode.FoldingRange(0, 2, vscode.FoldingRangeKind.Comment));
  });
});
