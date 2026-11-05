// Review V8 (2026-10-06): reconnecting the last servers must not be set off by
// merely opening a `.pro`/`.rux` offline from a repo — that showed "Server
// offline" toasts for servers the user never meant to reach.
//
// VS Code does not tell `activate()` WHICH event fired. The open documents do:
// a TM1 file language open is taken as the `onLanguage` activation. Everything
// else (a command, a notebook, the debugger, the view) restores at once, as
// before. The deferred case restores as soon as a TM1 view is visible
// (`extension.ts` checks that once the views exist).

/** Languages that can be opened offline and activate the extension. */
const OFFLINE_FILE_LANGUAGES: ReadonlySet<string> = new Set(['ti', 'tm1rules', 'tm1mdx']);

export function restoreAtActivation(input: {
  openLanguageIds: readonly string[];
  tm1NotebookOpen: boolean;
}): boolean {
  return input.tm1NotebookOpen || !input.openLanguageIds.some((id) => OFFLINE_FILE_LANGUAGES.has(id));
}
