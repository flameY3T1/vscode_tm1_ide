// src/webviewClient/securityUserGroup/protocol.ts
import type { User, NewUserInput } from '../../security/types/user';
import type { Group } from '../../security/types/group';

export type HostToWebview =
  // `aliasDefs` = alias attributes of `}Clients`, `alias` = the remembered choice
  // of this server. The associated values do not come along: they cost an
  // element query and are fetched only once a choice is made.
  // `self` = the logged-in user. Taking over oneself is an
  // idle operation that looks like a failure — so the row does not get the button.
  | {
      type: 'init'; users: User[]; groups: Group[]; v12Mode: boolean;
      aliasDefs: string[]; alias: string; self: string;
    }
  | { type: 'refreshed'; users: User[]; groups: Group[] }
  | { type: 'userCreated'; user: User }
  | { type: 'userDeleted'; userName: string }
  | { type: 'groupCreated'; group: Group }
  | { type: 'groupDeleted'; groupName: string }
  | { type: 'passwordSet'; userName: string }
  | {
      type: 'membershipsSaved';
      ok: Array<{ user: string; group: string; op: 'add' | 'remove' }>;
      errors: Array<{ user: string; group: string; op: 'add' | 'remove'; reason: string }>;
    }
  | { type: 'aliasValues'; alias: string; values: Record<string, string> }
  | { type: 'error'; message: string };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'refresh' }
  | { type: 'setAlias'; alias: string }
  | { type: 'createUser'; input: NewUserInput }
  | { type: 'deleteUser'; userName: string }
  | { type: 'setPassword'; userName: string; password: string }
  | { type: 'impersonate'; userName: string; label: string }
  | { type: 'createGroup'; name: string }
  | { type: 'deleteGroup'; groupName: string }
  | {
      type: 'saveMemberships';
      changes: Array<{ user: string; group: string; op: 'add' | 'remove' }>;
    };
