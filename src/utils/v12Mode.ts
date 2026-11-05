import * as vscode from 'vscode';
import type { Tm1Config } from '../tm1Rest/transport/types';

/**
 * Whether v12 rules apply right now.
 *
 * Two ways in, and the server is the stronger one: working against a v12 database means the
 * v12 restrictions are real whether or not anyone clicked the status-bar switch. The switch
 * stays for the other direction — reviewing code destined for v12 while connected to an 11.x
 * server, or with no connection at all.
 *
 * `config` is undefined wherever the surface has no server context (a loose .pro file); the
 * setting alone decides there.
 */
export function isV12Active(config?: Tm1Config): boolean {
  if (config?.version === 'v12') { return true; }
  return vscode.workspace.getConfiguration('tm1').get<boolean>('v12Mode', false);
}

/** True when v12 rules apply only because the connected server is v12, not by the setting. */
export function isV12FromServer(config?: Tm1Config): boolean {
  return config?.version === 'v12'
    && !vscode.workspace.getConfiguration('tm1').get<boolean>('v12Mode', false);
}
