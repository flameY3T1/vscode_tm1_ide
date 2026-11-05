import { describe, it, expect } from 'vitest';
import { Uri } from 'vscode';
import { getCallGraphHtml } from '../../references/callGraphWebview';
import type { CallGraphNode } from '../../references/callGraph';

function node(name: string, children: CallGraphNode[] = []): CallGraphNode {
  return { process: name, children, env: new Map() } as unknown as CallGraphNode;
}

describe('call-graph toolbar', () => {
  const root = node('Root', [node('A'), node('B')]);

  it('renders both direction tabs and marks the active one', () => {
    const html = getCallGraphHtml(root, 'downstream', 'Root', { downstream: 2, upstream: 5 });
    expect(html).toContain('data-dir="downstream"');
    expect(html).toContain('data-dir="upstream"');
    expect(html).toMatch(/class="tab active" data-dir="downstream"/);
    expect(html).not.toMatch(/class="tab active" data-dir="upstream"/);
  });

  it('labels each tab with its own size, so an empty direction is visible upfront', () => {
    const html = getCallGraphHtml(root, 'downstream', 'Root', { downstream: 2, upstream: 0 });
    // Counts belong to their own tab: 2 on "Calls", 0 on "Called by".
    expect(html).toMatch(/data-dir="downstream"[\s\S]*?<span class="n">2<\/span>/);
    expect(html).toMatch(/data-dir="upstream"[\s\S]*?<span class="n">0<\/span>/);
  });

  it('falls back to the rendered direction when no counts are passed', () => {
    const html = getCallGraphHtml(root, 'upstream', 'Root');
    expect(html).toMatch(/data-dir="upstream"[\s\S]*?<span class="n">2<\/span>/);
  });

  it('renders the tree process icon per row when a webview is supplied', () => {
    const webview = { asWebviewUri: (u: unknown) => u, cspSource: 'vscode-resource:' } as never;
    const extensionUri = Uri.file('/ext');
    const html = getCallGraphHtml(root, 'downstream', 'Root', undefined, { webview, extensionUri });
    expect(html).toContain('media/icons/light/process.svg');
    expect(html).toContain('media/icons/dark/process.svg');
    expect(html).not.toContain('>●<');
    // img-src must allow the panel's own resource scheme.
    expect(html).toContain('vscode-resource:');
  });

  it('renders without icons when no webview is supplied', () => {
    const html = getCallGraphHtml(root, 'downstream', 'Root');
    expect(html).not.toContain('<img');
  });

  it('keeps the direct/total summary', () => {
    const html = getCallGraphHtml(root, 'downstream', 'Root', { downstream: 2, upstream: 0 });
    expect(html).toContain('2 direct · 2 in total');
  });
});
