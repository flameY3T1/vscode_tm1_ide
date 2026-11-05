export interface ValidationResult { ok: boolean; reason?: string; }

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

export function validatePassword(pw: string): ValidationResult {
  if (!pw || pw.length < 8) return { ok: false, reason: 'Password must be at least 8 characters' };
  return { ok: true };
}

export function validateUserName(name: string): ValidationResult {
  if (!name) return { ok: false, reason: 'Name required' };
  if (!NAME_PATTERN.test(name)) return { ok: false, reason: 'Name must match [A-Za-z0-9_-]+' };
  return { ok: true };
}

export function validateGroupName(name: string, existing: string[]): ValidationResult {
  if (!name) return { ok: false, reason: 'Group name required' };
  const lower = name.toLowerCase();
  if (existing.some(e => e.toLowerCase() === lower)) {
    return { ok: false, reason: 'Group name already exists' };
  }
  return { ok: true };
}
