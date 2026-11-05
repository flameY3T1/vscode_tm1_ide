export {};

// MUST come before any access to `KNOWN_SIGNATURES`: the map is empty at
// load time and is only filled by this bootstrap from the embedded JSON.
import '../_shared/sigsBootstrap';
import * as monaco from 'monaco-editor';
import { registerTiLanguage } from '../processEditorMonaco/tiMonarch';
import { KNOWN_SIGNATURES } from '../../tiLogicVisualizer/tiSignatures';
import {
  renderParameters, getParameters, setOnChange as setParamsOnChange,
  type ProcessParameter,
} from '../processEditorMonaco/parameters';
import {
  renderDataSource, getDataSource, setOnChange as setDsOnChange, setServerBridge, setDsHost,
  type DataSource,
} from '../processEditorMonaco/dataSource';
import {
  renderVariables, getVariables, setOnChange as setVarsOnChange,
  type ProcessVariable,
} from '../processEditorMonaco/variables';
import { getL10n } from '../_shared/l10n';
import { getVsCodeApi } from '../_shared/vscodeApi';
import type { WebviewToHost } from './protocol';
import type { ProcessTemplateSource } from '../../processTemplates/processTemplateTypes';

const L = getL10n();

(self as any).MonacoEnvironment = {
  getWorker: () => ({
    postMessage: () => {}, terminate: () => {}, onmessage: null,
    addEventListener: () => {}, removeEventListener: () => {},
  }),
};

const vscode = getVsCodeApi<WebviewToHost>();

// TI language — with built-in completions, no server-object completions
const builtins: string[] = Array.from(KNOWN_SIGNATURES.values()).filter(sig => !sig.rulesOnly).map(sig => sig.name);
registerTiLanguage(monaco, builtins);

// No-op bridge — DataSource panel renders fully, server-lookup buttons silently do nothing
setServerBridge({
  fetchCubes: () => {}, fetchViews: () => {}, fetchDimensions: () => {},
  fetchSubsets: () => {}, fetchCubeDimensions: () => {}, fetchOdbcDsns: () => {},
  fetchAsciiPreview: () => {}, fetchOdbcPreview: () => {}, applyVariables: () => {},
});

// Monaco models — one per code section
type SectionKey = 'prolog' | 'metadata' | 'data' | 'epilog';
const models: Record<SectionKey, monaco.editor.ITextModel> = {
  prolog:   monaco.editor.createModel('', 'ti'),
  metadata: monaco.editor.createModel('', 'ti'),
  data:     monaco.editor.createModel('', 'ti'),
  epilog:   monaco.editor.createModel('', 'ti'),
};

function updateLineCountBadge(section: SectionKey): void {
  const el = document.getElementById('lc-' + section);
  if (!el) { return; }
  const text = models[section].getValue();
  const n = text.length === 0 ? 0 : models[section].getLineCount();
  el.textContent = n > 0 ? String(n) : '';
}

const editorContainer = document.getElementById('monaco-editor-mount')!;
const editor = monaco.editor.create(editorContainer, {
  model: models.prolog,
  theme: document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast') ? 'vs-dark' : 'vs',
  automaticLayout: true,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  lineNumbers: 'on',
});

new MutationObserver(() => {
  const dark = document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast');
  monaco.editor.setTheme(dark ? 'vs-dark' : 'vs');
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });

// Tab switching
function switchTab(tabName: string, section?: SectionKey): void {
  document.querySelectorAll<HTMLElement>('.tab').forEach(t => {
    if (section) {
      t.classList.toggle('active', t.dataset.tab === 'code' && t.dataset.section === section);
    } else {
      t.classList.toggle('active', t.dataset.tab === tabName && !t.dataset.section);
    }
  });
  document.querySelectorAll<HTMLElement>('.panel').forEach(p =>
    p.classList.toggle('active', p.id === `panel-${tabName}`));
  if (section) {
    editor.setModel(models[section]);
    editor.focus();
  }
}

document.querySelectorAll<HTMLElement>('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tab;
    if (!t) { return; }
    if (t === 'code') { switchTab('code', (tab.dataset.section ?? 'prolog') as SectionKey); }
    else { switchTab(t); }
  });
});

// Load initial data from window.__TEMPLATE_INIT__
const init = (window as any).__TEMPLATE_INIT__ as {
  name: string; description: string; servers: string;
  prolog: string; metadata: string; data: string; epilog: string;
  params: ProcessParameter[]; variables: ProcessVariable[]; dataSource: DataSource;
};

(document.getElementById('tpl-name') as HTMLInputElement).value = init.name;
(document.getElementById('tpl-desc') as HTMLInputElement).value = init.description;
(document.getElementById('tpl-servers') as HTMLInputElement).value = init.servers;

models.prolog.setValue(init.prolog);
models.metadata.setValue(init.metadata);
models.data.setValue(init.data);
models.epilog.setValue(init.epilog);

(Object.keys(models) as SectionKey[]).forEach(s => {
  updateLineCountBadge(s);
  models[s].onDidChangeContent(() => updateLineCountBadge(s));
});

renderParameters(init.params ?? []);
// A template never keeps an ODBC password — the datasource form must not offer
// a field for one here.
setDsHost('template');
renderDataSource(init.dataSource ?? { Type: 'None' });
renderVariables(init.variables ?? []);

function updateVariablesTabVisibility(): void {
  const ds = getDataSource();
  const tabEl = document.getElementById('tab-variables') as HTMLElement | null;
  if (!tabEl) { return; }
  const hide = ds.Type === 'None';
  tabEl.style.display = hide ? 'none' : '';
  // If currently on variables tab and it gets hidden, switch to template-info
  if (hide && document.querySelector('#panel-variables.active')) {
    switchTab('template-info');
  }
}

setParamsOnChange(() => {});
setDsOnChange(() => updateVariablesTabVisibility());
setVarsOnChange(() => {});

updateVariablesTabVisibility(); // set initial state

// Inline validation feedback for the template name.
//
// `alert()` is blocked in the webview sandbox — it showed nothing at all, so an
// empty name looked like a Save button that silently did nothing. The message is
// rendered next to the field instead; since Save is reachable from every tab, the
// Template-info tab is activated first so the error is actually on screen.
const nameInput = document.getElementById('tpl-name') as HTMLInputElement;
const nameErrorEl = document.getElementById('tpl-name-error');

function setNameError(message: string | null): void {
  if (nameErrorEl) {
    nameErrorEl.textContent = message ?? '';
    nameErrorEl.style.display = message ? '' : 'none';
  }
  nameInput.classList.toggle('invalid', Boolean(message));
  nameInput.setAttribute('aria-invalid', message ? 'true' : 'false');
}

setNameError(null);
nameInput.addEventListener('input', () => {
  if (nameInput.value.trim()) { setNameError(null); }
});

// Save
document.getElementById('btn-save')!.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    switchTab('template-info');
    setNameError(L.tplNameRequired);
    nameInput.focus();
    return;
  }
  setNameError(null);
  vscode.postMessage({
    type: 'save',
    name,
    description: (document.getElementById('tpl-desc') as HTMLInputElement).value,
    servers: (document.getElementById('tpl-servers') as HTMLInputElement).value,
    PrologProcedure: models.prolog.getValue(),
    MetadataProcedure: models.metadata.getValue(),
    DataProcedure: models.data.getValue(),
    EpilogProcedure: models.epilog.getValue(),
    // The editor's parameter rows type `Type` as plain string; its <select> only
    // offers 'String' / 'Numeric'.
    Parameters: getParameters() as ProcessTemplateSource['Parameters'],
    DataSource: getDataSource(),
    Variables: getVariables(),
  });
});

document.getElementById('btn-cancel')!.addEventListener('click', () =>
  vscode.postMessage({ type: 'cancel' }));
