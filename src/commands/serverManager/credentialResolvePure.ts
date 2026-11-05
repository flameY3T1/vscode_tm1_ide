/**
 * Which credentials a connection uses — pure, without `vscode` and without
 * SecretStorage, so every rule can be tested without an ExtensionContext.
 *
 * Only type imports from `state.ts`: a value import would pull in `vscode`
 * and the depcruise rule `pure-no-vscode` would break the build.
 */
import type { AuthType, CredentialSet, ServerProfile } from '../../serverState/state';

export type ResolvedCredentials =
  | { ok: true; username: string; password: string; authType: AuthType; camNamespace?: string }
  | { ok: false; missingCredentialId: string };

type ProfileFields = Pick<ServerProfile, 'username' | 'authType' | 'camNamespace' | 'credentialId'>;

/**
 * Either everything from the credential set or everything from the profile —
 * never mixed.
 *
 * If a profile points to a set that no longer exists, that's an error and
 * not a reason to fall back to the profile fields: those would then carry
 * values from before the reference was made.
 */
export function resolveCredentials(
  profile: ProfileFields,
  set: CredentialSet | undefined,
  ownPassword: string,
  setPassword: string,
): ResolvedCredentials {
  if (!profile.credentialId) {
    return {
      ok: true,
      username: profile.username,
      password: ownPassword,
      authType: profile.authType,
      camNamespace: profile.camNamespace,
    };
  }
  if (!set) { return { ok: false, missingCredentialId: profile.credentialId }; }
  return {
    ok: true,
    username: set.username,
    password: setPassword,
    authType: set.authType,
    camNamespace: set.camNamespace,
  };
}
