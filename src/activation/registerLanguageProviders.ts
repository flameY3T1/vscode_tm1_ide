import * as vscode from 'vscode';
import {
  Tm1CompletionProvider, TiFunctionCompletionProvider, TiVariableCompletionProvider, TiContextCompletionProvider,
} from '../providers/tm1CompletionProvider';
import {
  RulesFunctionCompletionProvider, RulesKeywordCompletionProvider, RulesServerCompletionProvider,
} from '../providers/rulesCompletionProvider';
import { Tm1SignatureHelpProvider } from '../providers/tm1SignatureHelpProvider';
import { TiRenameProvider } from '../providers/tiRenameProvider';
import { TiReferencesProvider } from '../providers/tiReferencesProvider';
import { TiSnippetCompletionProvider } from '../snippets/snippetCompletionProvider';
import { TiFoldingProvider, RulesFoldingProvider } from '../providers/tiFoldingProvider';
import { TiFormattingProvider, RulesFormattingProvider } from '../providers/tiFormattingProvider';
import { TiSymbolProvider, RulesSymbolProvider } from '../providers/tiSymbolProvider';
import type { ActivationContext } from './context';

// Language id only: `.pro` is also Qt/Prolog — the user's language mode decides.
const TI_SELECTOR = [{ language: 'ti' }];

const RULES_SELECTOR = [{ language: 'tm1rules' }];

/**
 * Registers language service providers for TI (.pro/.ti) and Rules (.rux):
 *   - 5 completion providers (TI functions, TM1 names, variables, string-context, snippets)
 *   - signature help, rename, references
 *   - folding (IF/WHILE, comment runs, SKIPCHECK/FEEDERS, #Region) for TI and Rules
 *   - formatting (Shift+Alt+F) and outline/breadcrumbs for TI and Rules
 *
 * Everything here runs on documents VS Code owns; the webview editors register
 * their own Monaco providers. Server-backed checks stay out of this list: a file
 * on disk has no server binding, so only the linter (TiDiagnosticsProvider, on
 * the active connection) touches the network.
 *   - 3 rules completion providers (functions, keywords, server context)
 */
export function registerLanguageProviders(ctx: ActivationContext): void {
  const { context, snippetStorage, getActiveServer } = ctx;

  context.subscriptions.push(
    vscode.languages.registerCompletionItemProvider(TI_SELECTOR, new TiFunctionCompletionProvider()),
    vscode.languages.registerCompletionItemProvider(TI_SELECTOR, new Tm1CompletionProvider()),
    vscode.languages.registerCompletionItemProvider(TI_SELECTOR, new TiVariableCompletionProvider()),
    vscode.languages.registerCompletionItemProvider(TI_SELECTOR, new TiContextCompletionProvider(), "'"),
    vscode.languages.registerCompletionItemProvider(
      TI_SELECTOR,
      new TiSnippetCompletionProvider(snippetStorage, getActiveServer),
    ),
    vscode.languages.registerSignatureHelpProvider(TI_SELECTOR, new Tm1SignatureHelpProvider(), '(', ','),
    vscode.languages.registerRenameProvider(TI_SELECTOR, new TiRenameProvider()),
    vscode.languages.registerReferenceProvider(TI_SELECTOR, new TiReferencesProvider()),
    vscode.languages.registerFoldingRangeProvider(TI_SELECTOR, new TiFoldingProvider()),
    vscode.languages.registerFoldingRangeProvider(RULES_SELECTOR, new RulesFoldingProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(TI_SELECTOR, new TiFormattingProvider()),
    vscode.languages.registerDocumentFormattingEditProvider(RULES_SELECTOR, new RulesFormattingProvider()),
    vscode.languages.registerDocumentSymbolProvider(TI_SELECTOR, new TiSymbolProvider()),
    vscode.languages.registerDocumentSymbolProvider(RULES_SELECTOR, new RulesSymbolProvider()),

    vscode.languages.registerCompletionItemProvider(RULES_SELECTOR, new RulesFunctionCompletionProvider()),
    vscode.languages.registerCompletionItemProvider(RULES_SELECTOR, new RulesKeywordCompletionProvider()),
    vscode.languages.registerCompletionItemProvider(RULES_SELECTOR, new RulesServerCompletionProvider(), "'", "["),
  );
}
