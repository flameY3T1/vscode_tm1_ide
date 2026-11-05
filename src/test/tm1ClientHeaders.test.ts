import { describe, it, expect } from 'vitest';
import { type Tm1Config } from '../tm1Client';
import { buildHeaders } from '../tm1Rest/transport/auth';

const basicCfg: Tm1Config = {
  serverUrl: 'http://localhost:8010',
  username: 'admin',
  password: 'apple',
  rejectUnauthorized: false,
  authType: 'Basic',
};

const camCfg: Tm1Config = {
  ...basicCfg,
  authType: 'CAM',
  camNamespace: 'LDAP',
};

describe('tm1Client — buildHeaders client identification', () => {
  it('sets User-Agent with extension id', () => {
    const h = buildHeaders(basicCfg);
    expect(h['User-Agent']).toMatch(/^vscode-tm1-ide\//);
  });

  it('sets both SessionContext header variants to extension id for Basic auth', () => {
    const h = buildHeaders(basicCfg);
    expect(h['TM1-SessionContext']).toMatch(/^vscode-tm1-ide\//);
    expect(h['TM1-Session-Context']).toMatch(/^vscode-tm1-ide\//);
    // Both must carry the same payload so /Threads.Context is populated consistently.
    expect(h['TM1-SessionContext']).toBe(h['TM1-Session-Context']);
  });

  it('sends the plain client id for CAM too — TM1 shows it as Session.Context', () => {
    // A JSON blob here would render as JSON in the /Threads Context column; the
    // namespace belongs in the Authorization credential, not in this header.
    const h = buildHeaders(camCfg);
    for (const name of ['TM1-SessionContext', 'TM1-Session-Context']) {
      expect(h[name]).toMatch(/^vscode-tm1-ide\//);
      expect(h[name]).not.toContain('CAMNamespace');
    }
  });

  it('still sets Authorization and Content-Type', () => {
    const h = buildHeaders(basicCfg);
    expect(h['Authorization']).toMatch(/^Basic /);
    expect(h['Content-Type']).toBe('application/json');
  });

  it('CAM Authorization encodes user:password:namespace per IBM spec', () => {
    const h = buildHeaders(camCfg);
    const auth = h['Authorization'] as string;
    expect(auth).toMatch(/^CAMNamespace /);
    const decoded = Buffer.from(auth.replace(/^CAMNamespace /, ''), 'base64').toString('utf8');
    expect(decoded).toBe('admin:apple:LDAP');
  });

  it('sets Content-Length when a body is provided', () => {
    const body = JSON.stringify({ x: 1 });
    const h = buildHeaders(basicCfg, body);
    expect(h['Content-Length']).toBe(Buffer.byteLength(body));
  });

  it('allows extraHeaders to override without dropping User-Agent', () => {
    const h = buildHeaders(basicCfg, undefined, { 'If-Match': '*' });
    expect(h['If-Match']).toBe('*');
    expect(h['User-Agent']).toMatch(/^vscode-tm1-ide\//);
  });
});

describe('tm1Client — buildHeaders cookie mode', () => {
  it('adds Cookie and omits Authorization when cookie is provided', () => {
    const h = buildHeaders(basicCfg, undefined, undefined, 'TM1SessionId=abc');
    expect(h['Cookie']).toBe('TM1SessionId=abc');
    expect(h['Authorization']).toBeUndefined();
  });

  it('keeps User-Agent and TM1-SessionContext in cookie mode', () => {
    const h = buildHeaders(basicCfg, undefined, undefined, 'TM1SessionId=abc');
    expect(h['User-Agent']).toMatch(/^vscode-tm1-ide\//);
    expect(h['TM1-SessionContext']).toBeDefined();
  });

  it('sends Authorization when cookie is not provided (unchanged default)', () => {
    const h = buildHeaders(basicCfg);
    expect(h['Authorization']).toMatch(/^Basic /);
    expect(h['Cookie']).toBeUndefined();
  });
});

describe('tm1Client — buildHeaders Connection (keep-alive against VS Code\'s PacProxyAgent)', () => {
  it('sets Connection: keep-alive explicitly', () => {
    // Otherwise Node derives `shouldKeepAlive` from `req.agent`, and VS Code's
    // proxy patch replaces our agent with one without keep-alive — then
    // `Connection: close` would go out and TM1 would get a new
    // worker thread per request. An explicitly set header beats the derivation.
    expect(buildHeaders(basicCfg)['Connection']).toBe('keep-alive');
  });

  it('leaves a supplied Connection header in place (no duplicate)', () => {
    const h = buildHeaders(basicCfg, undefined, { connection: 'close' });
    expect(h['Connection']).toBeUndefined();
    expect(h['connection']).toBe('close');
  });
});
