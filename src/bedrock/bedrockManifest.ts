import JSZip = require('jszip');
import { parseSections, toRestVariables, toRestParameters, toRestDataSource, toProUiData, toProHasSecurity } from '../utils/proFile';
import { splitVariableColumns } from '../utils/processVariablesUi';
import type { BedrockEdition } from './bedrockRelease';

export interface BedrockManifestEntry {
  name: string;
  payload: Record<string, any>;
}

/** Processes that cannot be created on an arbitrary TM1 server because
 *  their data source points at the Bedrock authors' development machine.
 *  Measured in BOTH releases: v4 and v5 both ship ASCII sources with paths
 *  such as `D:/TM1Models/Bedrock.v4/Data/Attribute.csv` and a cube-view source
 *  on `}ElementAttributes_}Clients` — a system cube that not every model
 *  has. The processes work once a custom source is set; creating them fails
 *  before that.
 *
 *  @param name  process name (`}bedrock.…`)
 *  @param dsType `DataSource.Type`
 *  @param dsName source name — for `TM1CubeView` the cube. */
export function skipBedrockProcess(name: string, dsType: string, dsName: string): boolean {
  if (name.startsWith('}') && dsType === 'ASCII') { return true; }
  if (dsType === 'TM1CubeView' && dsName.startsWith('}ElementAttributes')) { return true; }
  return false;
}

export async function loadBedrockManifest(zipBuffer: Buffer): Promise<BedrockManifestEntry[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const out: BedrockManifestEntry[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) { continue; }
    if (!/\.pro$/i.test(path)) { continue; }
    const content = await entry.async('string');
    const nameMatch = content.match(/^602,"([^"]+)"/m);
    if (!nameMatch) { continue; }

    // Install only the classic control-object library (`}bedrock.*`, from the
    // repo's `main/` folder). The repo ALSO ships a b3shell variant with
    // PascalCase names (`Bedrock.*`, from `b3shell/`); installing both doubles
    // the process count on the server (~91 → ~170) and is redundant, so skip
    // anything that is not a `}bedrock.` process.
    if (!/^\}bedrock\./i.test(nameMatch[1])) { continue; }

    const ds = toRestDataSource(content);
    const cubeMatch = content.match(/^586,"([^"]+)"/m);
    if (skipBedrockProcess(nameMatch[1], String(ds.Type ?? ''), cubeMatch?.[1] ?? '')) { continue; }

    const sections = parseSections(content);
    const uiData = toProUiData(content);
    const hasSecurity = toProHasSecurity(content);
    // The payload goes to TM1 verbatim, so the column list has to be split back
    // into the two wire properties — `Ignored` is an editor-side field.
    const { Variables, VariablesUIData } = splitVariableColumns(toRestVariables(content));
    out.push({
      name: nameMatch[1],
      payload: {
        PrologProcedure:   sections.prolog,
        MetadataProcedure: sections.metadata,
        DataProcedure:     sections.data,
        EpilogProcedure:   sections.epilog,
        Parameters:        toRestParameters(content),
        Variables:         Variables,
        VariablesUIData:   VariablesUIData,
        DataSource:        toRestDataSource(content),
        // Bedrock's processes are created by POST, which — unlike PATCH — starts
        // from nothing: without this the Architect wizard state is dropped.
        ...(uiData !== undefined ? { UIData: uiData } : {}),
        // Footer line 1217; 84 of the 91 v4 processes run with security access on.
        ...(hasSecurity !== undefined ? { HasSecurityAccess: hasSecurity } : {}),
      },
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Bedrock 5 NO LONGER ships `.pro` files; instead it ships, under
 *  `bedrock_processes_json/`, one JSON file per process that is already the
 *  finished REST payload (`Name`, `PrologProcedure`, `Parameters`,
 *  `DataSource`, `VariablesUIData`, …). So there is nothing to
 *  translate here — only to read, to filter, and to split `Name` off the body,
 *  because `PATCH Processes('…')` with `Name` in the body counts on TM1 as a
 *  rename and silently discards the rest.
 *
 *  Measured on v5.4.0: 97 process files, all with the `}bedrock.` prefix, plus
 *  two outsiders under `installation_files/assets/` without a `Name` field,
 *  which the check below filters out. */
export async function loadBedrockManifestJson(zipBuffer: Buffer): Promise<BedrockManifestEntry[]> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const out: BedrockManifestEntry[] = [];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) { continue; }
    if (!/\.json$/i.test(path)) { continue; }
    let parsed: unknown;
    try { parsed = JSON.parse(await entry.async('string')); }
    catch { continue; }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) { continue; }
    const { Name, ...payload } = parsed as Record<string, any>;
    if (typeof Name !== 'string' || !/^\}?bedrock\./i.test(Name)) { continue; }

    const ds = (payload.DataSource ?? {}) as Record<string, any>;
    if (skipBedrockProcess(Name, String(ds.Type ?? ''), String(ds.dataSourceNameForServer ?? ''))) { continue; }

    out.push({ name: Name, payload });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Switch on the package format of the release — v4 `.pro`, v5 JSON. */
export async function loadBedrockManifestFor(
  edition: BedrockEdition,
  zipBuffer: Buffer,
): Promise<BedrockManifestEntry[]> {
  return edition === 'v5' ? loadBedrockManifestJson(zipBuffer) : loadBedrockManifest(zipBuffer);
}
