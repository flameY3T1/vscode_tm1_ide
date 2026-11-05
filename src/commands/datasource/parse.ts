/**
 * .pro file → DatasourceConfig parser.
 *
 * The variable reader also used to live here; it went with the `.pro` wizard
 * (2026-08-30). Whoever needs variables from a `.pro` uses
 * `utils/proFile#toRestVariables` — the reader that export and deploy use.
 */

import { type DatasourceConfig, type DatasourceType, DATASOURCE_DEFAULTS } from './types';

function stripQuotes(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) { return s.slice(1, -1).replace(/""/g, '"'); }
  return s;
}

function lineValue(line: string): string {
  const idx = line.indexOf(',');
  return idx === -1 ? '' : line.slice(idx + 1);
}

export function parseDatasourceFromFileContent(content: string): DatasourceConfig {
  const lines = content.split('\n').map(l => l.replace(/\r$/, ''));
  const cfg: DatasourceConfig = { ...DATASOURCE_DEFAULTS };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('562,')) { cfg.type = stripQuotes(lineValue(line)).toUpperCase() as DatasourceType; }
    // 586 = name for the server, 585 = name for the client. TM1 writes both;
    // the MCP export leaves 585 empty, so the server name wins when set.
    else if (line.startsWith('586,')) { const v = stripQuotes(lineValue(line)); if (v) { cfg.datasourceName = v; } }
    else if (line.startsWith('585,')) { cfg.datasourceClientName = stripQuotes(lineValue(line)); cfg.datasourceName ||= cfg.datasourceClientName; }
    // 570 holds the view, 571 the subset (Bedrock repo: `571,All`, 570 empty).
    else if (line.startsWith('570,')) { cfg.viewSubsetName = stripQuotes(lineValue(line)); }
    else if (line.startsWith('564,')) { cfg.odbcUsername = stripQuotes(lineValue(line)); }
    else if (line.startsWith('565,')) { cfg._line565 = line; }
    else if (line.startsWith('566,')) {
      const count = parseInt(lineValue(line), 10) || 0;
      if (count > 0) { cfg.sqlQuery = lines.slice(i + 1, i + 1 + count).join('\n'); i += count; }
    }
    else if (line.startsWith('567,')) { cfg.delimiter = stripQuotes(lineValue(line)); }
    else if (line.startsWith('568,')) { cfg.quoteChar = stripQuotes(lineValue(line)); }
    else if (line.startsWith('569,')) { cfg.titleRows = parseInt(lineValue(line), 10) || 0; }
    else if (line.startsWith('588,')) { cfg.decimalSep = stripQuotes(lineValue(line)); }
    else if (line.startsWith('589,')) { cfg.thousandSep = stripQuotes(lineValue(line)); }
    // 559 is the Unicode flag (`559,1` on, `559,0` off — measured 2026-08-17,
    // proUnicodeLineProbe.js). The raw line stays for the writer's
    // fallback; the parsed value is what the UI and the REST payload use.
    else if (line.startsWith('559,')) { cfg._line559 = line; cfg.usesUnicode = lineValue(line).trim() === '1'; }
    else if (line.startsWith('928,')) { cfg._line928 = line; }
    else if (line.startsWith('593,')) { cfg._line593 = line; }
    else if (line.startsWith('594,')) { cfg._line594 = line; }
    else if (line.startsWith('595,')) { cfg._line595 = line; }
    else if (line.startsWith('597,')) { cfg._line597 = line; }
    else if (line.startsWith('598,')) { cfg._line598 = line; }
    else if (line.startsWith('596,')) { cfg._line596 = line; }
    else if (line.startsWith('800,')) { cfg._line800 = line; }
    else if (line.startsWith('801,')) { cfg._line801 = line; }
    else if (line.startsWith('592,')) { cfg._line592 = line; }
    else if (line.startsWith('571,')) { cfg._line571 = line; if (cfg.type === 'SUBSET') { cfg.viewSubsetName = stripQuotes(lineValue(line)) || cfg.viewSubsetName; } }
  }
  return cfg;
}
