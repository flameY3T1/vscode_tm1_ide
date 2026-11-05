import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { assertOk } from '../tm1Rest/transport/http';
import { Tm1HttpError } from '../tm1Rest/httpError';

function* tsFiles(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name !== 'test' && e.name !== 'webviewClient') { yield* tsFiles(p); }
    } else if (p.endsWith('.ts')) { yield p; }
  }
}

describe('Tm1HttpError', () => {
  it('assertOk throws it with status and OData code', () => {
    const body = JSON.stringify({ error: { code: '278', message: 'bad' } });
    try {
      assertOk({ statusCode: 400, body }, 'GET x');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(Tm1HttpError);
      expect((e as Tm1HttpError).statusCode).toBe(400);
      expect((e as Tm1HttpError).odataCode).toBe('278');
      expect((e as Error).message).toBe('GET x: HTTP 400: bad');
    }
  });

  it('no response is checked for 2xx by hand — use isOk(res)', () => {
    const inline = /\.statusCode ?(>= ?200 && [\w.]+ ?< ?300|< ?200 \|\| [\w.]+ ?>= ?300)/;
    const hits: string[] = [];
    for (const f of tsFiles(path.join(__dirname, '..'))) {
      if (f.endsWith('httpError.ts')) { continue; }
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
        if (inline.test(l)) { hits.push(`${path.relative(process.cwd(), f)}:${i + 1}`); }
      });
    }
    expect(hits).toEqual([]);
  });
});
