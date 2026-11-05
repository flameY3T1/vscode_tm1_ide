import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { getRuleEditorMonacoHtml } from '../commands/rule/ruleEditorMonacoWebview';

vi.mock('vscode', async () => await import('./__mocks__/vscode'));
vi.mock('../utils/sigsAsset', () => ({
  getInlineSignaturesJson: () => '{}',
  getInlineSignatureDocsJson: () => '{}',
}));

describe('Rule Editor gutter CSS', () => {
  it('keeps the folding column on the code side of the divider', () => {
    const webview = {
      cspSource: 'vscode-webview:',
      asWebviewUri: (uri: unknown) => String(uri),
    } as unknown as vscode.Webview;
    const html = getRuleEditorMonacoHtml(webview, vscode.Uri.file('/ext'));
    const marginRule = html.match(/\.monaco-editor \.margin \{([^}]+)\}/)?.[1] ?? '';

    expect(marginRule).not.toContain('border-right');
    expect(marginRule).toContain('rgba(128, 128, 128, 0.28)');
  });
});
