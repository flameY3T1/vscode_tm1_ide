export {};

import * as monaco from 'monaco-editor';

(globalThis as unknown as { monaco: typeof monaco }).monaco = monaco;
