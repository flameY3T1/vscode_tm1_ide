// src/webviewClient/processEditorMonaco/crossSectionFind.ts
// Process editor find/replace across the 4 TI sections. Thin adapter over the
// generic `_shared/findOverlay` — this file only maps the sections onto the
// overlay's source models. The rule editor uses the same overlay with a single
// source. Shared logic + snippet building live in `_shared/`.
import type * as monacoNS from 'monaco-editor';
import { initFindOverlay } from '../_shared/findOverlay';
import type { SectionKey } from './sectionTypes';

const SECTION_ORDER: SectionKey[] = ['prolog', 'metadata', 'data', 'epilog'];
const SECTION_LABEL: Record<SectionKey, string> = {
  prolog: 'Prolog', metadata: 'Metadata', data: 'Data', epilog: 'Epilog',
};

interface FindHost {
  getModels: () => Record<SectionKey, monacoNS.editor.ITextModel>;
  getEditor: () => monacoNS.editor.IStandaloneCodeEditor;
  switchToSection: (s: SectionKey) => void;
}

export function initCrossSectionFind(monaco: typeof monacoNS, host: FindHost): void {
  initFindOverlay(monaco, {
    getSources: () => {
      const models = host.getModels();
      return SECTION_ORDER.map(s => ({ key: s, label: SECTION_LABEL[s], model: models[s] }));
    },
    getEditor: host.getEditor,
    activate: (key) => host.switchToSection(key as SectionKey),
  });
}
