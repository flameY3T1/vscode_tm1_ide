// src/tm1Rest/managementApi.ts
// TM1 v12 management-plane (/manage/v1) discovery.
// Root-Basic auth for Instances + Databases listing.
// Pure parse helpers tolerate malformed → [].

import { _rawRequest } from './transport/http';
import type { Tm1Config } from './transport/types';
import { buildTm1Config } from './transport/authConfig';
import { resolveAgent } from './transport/agent';
import { encodeODataKey } from '../utils/odataKey';
import { isOk, Tm1HttpError } from './httpError';

export interface RootCreds {
  serverUrl: string;
  clientId: string;
  clientSecret: string;
  rejectUnauthorized?: boolean;
}

export interface InstanceRef {
  id: string;
  name: string;
}

export function parseInstances(body: string): InstanceRef[] {
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data?.value)) return [];
    // C4: guard per element — a `value:[null]` (or primitive) must not throw
    // inside the try and get swallowed to [], masking a server contract breach.
    return data.value
      .filter((v: any) => v && typeof v === 'object')
      .map((v: any) => ({
        id: String(v.ID ?? ''),
        name: String(v.Name ?? ''),
      }))
      .filter((x: InstanceRef) => x.name);
  } catch {
    return [];
  }
}

export function parseDatabases(body: string): string[] {
  try {
    const data = JSON.parse(body);
    if (!Array.isArray(data?.value)) return [];
    return data.value
      .filter((d: any) => d && typeof d === 'object')
      .map((d: any) => String(d.Name ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function rootCfg(root: RootCreds): Tm1Config {
  // Basic(clientId:clientSecret) — buildHeaders sends Authorization when no cookie.
  // Routed through buildTm1Config: single validating construction path for Tm1Config.
  return buildTm1Config(
    {
      serverUrl: root.serverUrl,
      username: root.clientId,
      password: root.clientSecret,
      rejectUnauthorized: root.rejectUnauthorized ?? true,
    },
    { authType: 'Basic' },
  );
}

async function manageRequest(
  root: RootCreds,
  method: string,
  path: string,
  body?: string,
): Promise<{ statusCode: number; body: string }> {
  const cfg = rootCfg(root);
  const url = `${root.serverUrl.replace(/\/$/, '')}/manage/v1/${path}`;
  const isHttps = url.startsWith('https:');
  const agent = resolveAgent(cfg, isHttps);
  try {
    const res = await _rawRequest(method, url, cfg, body, 30000, undefined, undefined, agent);
    return { statusCode: res.statusCode, body: res.body };
  } finally {
    agent.destroy();
  }
}

async function manageGet(root: RootCreds, path: string): Promise<string> {
  const res = await manageRequest(root, 'GET', path);
  if (!isOk(res)) {
    throw new Tm1HttpError(`Management API HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`, res.statusCode);
  }
  return res.body;
}

export async function listInstances(root: RootCreds): Promise<InstanceRef[]> {
  return parseInstances(await manageGet(root, 'Instances'));
}

export async function listDatabases(
  root: RootCreds,
  instance: string,
): Promise<string[]> {
  const inst = encodeODataKey(instance);
  return parseDatabases(await manageGet(root, `Instances('${inst}')/Databases`));
}

/** Creates a database in the instance. POST …/Databases {Name}. Verified: 201. */
export async function createDatabase(root: RootCreds, instance: string, name: string): Promise<void> {
  const inst = encodeODataKey(instance);
  const res = await manageRequest(root, 'POST', `Instances('${inst}')/Databases`, JSON.stringify({ Name: name }));
  if (!isOk(res)) {
    throw new Tm1HttpError(`Create database failed — HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`, res.statusCode);
  }
}

/**
 * Deletes a database. DELETE …/Databases('name'). Verified live against v12.
 * Destructive; callers must confirm first.
 */
export async function deleteDatabase(root: RootCreds, instance: string, name: string): Promise<void> {
  const inst = encodeODataKey(instance);
  const db = encodeODataKey(name);
  const res = await manageRequest(root, 'DELETE', `Instances('${inst}')/Databases('${db}')`);
  if (!isOk(res)) {
    throw new Tm1HttpError(`Delete database failed — HTTP ${res.statusCode}: ${res.body.slice(0, 200)}`, res.statusCode);
  }
}
