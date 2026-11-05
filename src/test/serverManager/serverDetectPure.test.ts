import { describe, it, expect } from 'vitest';
import { classifyServersAnswer, parseServerAddress, pawBehindLogin, pawChallenge, pawFrom } from '../../commands/serverManager/serverDetectPure';

// Answers as measured 2026-10-30 without credentials (see serverDetectPure.ts).
const V11 = { status: 401, challenges: ['Basic realm="TM1"'], body: '' };
const V12 = { status: 401, challenges: [], body: '{"error":{"code":"278","message":"Authentication required"}}' };
const ADMIN = {
  status: 200, challenges: [],
  body: '{"@odata.context":"$metadata#Servers","value":[{"Name":"A","AcceptingClients":true},{"Name":"B","AcceptingClients":false}]}',
};

describe('classifyServersAnswer', () => {
  it('reads v11 with Basic from the challenge', () => {
    expect(classifyServersAnswer(V11)).toEqual({ kind: 'v11', auth: 'Basic' });
  });
  it('reads CAM and integrated when Basic is not offered', () => {
    expect(classifyServersAnswer({ ...V11, challenges: ['CAMNamespace'] })).toEqual({ kind: 'v11', auth: 'CAM' });
    expect(classifyServersAnswer({ ...V11, challenges: ['Negotiate'] })).toEqual({ kind: 'v11', auth: 'integrated' });
  });
  it('reads v12 from a challenge-less 401 with code 278', () => {
    expect(classifyServersAnswer(V12)).toEqual({ kind: 'v12' });
  });
  it('reads an admin server and keeps stopped databases', () => {
    expect(classifyServersAnswer(ADMIN)).toEqual({
      kind: 'admin',
      databases: [{ name: 'A', acceptingClients: true }, { name: 'B', acceptingClients: false }],
    });
  });
  it('says nothing for an unrelated answer', () => {
    expect(classifyServersAnswer({ status: 404, challenges: [], body: 'Not found' })).toBeUndefined();
    expect(classifyServersAnswer({ status: 401, challenges: [], body: '{}' })).toBeUndefined();
  });
});

describe('pawFrom', () => {
  it('takes a 200 list, ignores the 404 a v11 server gives', () => {
    expect(pawFrom({ status: 200, challenges: [], body: '{"value":[{"Name":"P"}]}' })).toEqual([{ name: 'P', acceptingClients: true }]);
    expect(pawFrom({ status: 404, challenges: [], body: '' })).toBeUndefined();
  });
});

describe('parseServerAddress', () => {
  it('keeps only the origin of a plain address', () => {
    expect(parseServerAddress('https://h:8016/api/v1/Cubes')).toEqual({ origin: 'https://h:8016' });
  });
  it('pulls instance and database from a v12 REST URL', () => {
    expect(parseServerAddress("http://h:4444/tm1/api/v1/Databases('O''Neil')/Cubes"))
      .toEqual({ origin: 'http://h:4444', v12: { instance: 'tm1', database: "O'Neil" } });
  });
  it('names the database of a PAW instance URL', () => {
    expect(parseServerAddress('http://localhost:8080/api/v1/tm1/Sales/api/v1/Cubes'))
      .toEqual({ origin: 'http://localhost:8080', pawDatabase: 'Sales' });
    expect(parseServerAddress('http://localhost:8080/tm1/Servers')).toEqual({ origin: 'http://localhost:8080' });
  });
  it('pulls tenant and database from a SaaS URL', () => {
    expect(parseServerAddress('https://eu.planninganalytics.saas.ibm.com/api/ABC123/v0/tm1/Sales/api/v1/Cubes'))
      .toEqual({ origin: 'https://eu.planninganalytics.saas.ibm.com', saas: { tenant: 'ABC123', database: 'Sales' } });
  });
});

describe('pawBehindLogin', () => {
  it('reads a login redirect or a challenged 401 on /tm1/Servers as PAW', () => {
    expect(pawBehindLogin({ status: 302, challenges: [], body: '' })).toBe(true);
    expect(pawBehindLogin({ status: 401, challenges: ['Bearer'], body: '' })).toBe(true);
  });
  it('reads the 200 AUTH_REQUIRED answer of a company PAW as PAW (measured 2026-10-31)', () => {
    const body = '{"error":{"code":"AUTH_REQUIRED","message":{"authenticate":{"location":"/login"}}},"response":{"error":{"errorCode":"AuthorizedConnectionFailed"}}}';
    expect(pawBehindLogin({ status: 200, challenges: [], body })).toBe(true);
  });
  it('leaves v11 (404), v12 (401 without challenge) and a missing answer alone', () => {
    expect(pawBehindLogin({ status: 404, challenges: [], body: '' })).toBe(false);
    expect(pawBehindLogin(V12)).toBe(false);
    expect(pawBehindLogin(undefined)).toBe(false);
  });
});

describe('pawChallenge', () => {
  it('reads a Bearer challenge on /api/v1/Servers as PAW (company PAW, measured 2026-10-31)', () => {
    expect(pawChallenge({ status: 401, challenges: ['Bearer realm="Service"', 'Negotiate', 'Basic realm="TM1"'], body: '' })).toBe(true);
  });
  it('leaves v11 (Basic only) and v12 (no challenge) alone', () => {
    expect(pawChallenge(V11)).toBe(false);
    expect(pawChallenge(V12)).toBe(false);
  });
});
