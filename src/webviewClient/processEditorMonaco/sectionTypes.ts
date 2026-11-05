/**
 * Single source of truth for the TI section discriminator.
 *
 * The processEditorMonaco webview is partitioned into four sections
 * (prolog / metadata / data / epilog); virtually every sub-module needs
 * this union. Defined here in a vscode-free, dependency-free file so
 * pure modules and webview-runtime modules alike can import without
 * pulling extra weight.
 */
export type SectionKey = 'prolog' | 'metadata' | 'data' | 'epilog';
