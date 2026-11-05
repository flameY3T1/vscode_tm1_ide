/** Bedrock comes in two separate releases from two separate repos, and
 *  they are NOT interchangeable:
 *
 *  - `v4` (`cubewise-code/bedrock`, latest v4.1.4) for TM1 11.x / PA 2.0.x,
 *    minimum version PA 2.0.6 (TM1 Server 11.4).
 *  - `v5` (`cubewise-code/bedrock-5`, from v5.0.0) for TM1 Database 12.4+.
 *    Cubewise is explicit: "Bedrock 5 does not support earlier versions of
 *    the TM1 Database" — and conversely "If you are using PA TM1 Database
 *    12.4+ you must use Bedrock 5".
 *
 *  Until 2026-08-30 only the v4 repo was wired up here; on a v12 database
 *  that meant the 11.x library got installed.
 *
 *  The releases also differ in PACKAGE FORMAT, not just in code:
 *  v4 ships `.pro` files, v5 ships finished REST payloads as JSON — see
 *  `bedrockManifest.ts`. */
export type BedrockEdition = 'v4' | 'v5';

export const BEDROCK_REPOS: Record<BedrockEdition, string> = {
  v4: 'cubewise-code/bedrock',
  v5: 'cubewise-code/bedrock-5',
};

/** Release for the connected database. `cfg.version` only knows `v11`/`v12` and
 *  no minor version — but Bedrock 5 requires 12.4+. For 12.0–12.3 the
 *  choice is therefore formally too optimistic; the alternative (v4 on v12) is
 *  explicitly unsupported according to Cubewise, so v5 is the better half
 *  of a decision that the configuration does not let us make more precisely. */
export function bedrockEditionFor(cfg: { version?: 'v11' | 'v12' }): BedrockEdition {
  return cfg.version === 'v12' ? 'v5' : 'v4';
}

export interface BedrockRelease {
  tag: string;
  zipballUrl: string;
  edition: BedrockEdition;
}

export type JsonFetcher = (url: string) => Promise<any>;

export function bedrockReleasesUrl(edition: BedrockEdition): string {
  return `https://api.github.com/repos/${BEDROCK_REPOS[edition]}/releases/latest`;
}

export async function fetchLatestBedrockRelease(
  fetcher: JsonFetcher,
  edition: BedrockEdition = 'v4',
): Promise<BedrockRelease> {
  const body = await fetcher(bedrockReleasesUrl(edition));
  if (!body || typeof body.tag_name !== 'string' || typeof body.zipball_url !== 'string') {
    throw new Error('Invalid GitHub releases response — tag_name or zipball_url missing.');
  }
  return { tag: body.tag_name, zipballUrl: body.zipball_url, edition };
}

export async function httpsJsonFetcher(url: string): Promise<any> {
  const https = await import('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'vscode-tm1-ti', 'Accept': 'application/vnd.github+json' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsJsonFetcher(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('GitHub API HTTP ' + res.statusCode)); return; }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
  });
}

export async function httpsZipFetcher(url: string): Promise<Buffer> {
  const https = await import('https');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'vscode-tm1-ti' } }, res => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve(httpsZipFetcher(res.headers.location));
        return;
      }
      if (res.statusCode !== 200) { reject(new Error('Download HTTP ' + res.statusCode)); return; }
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
  });
}
