
const ILLEGAL_CHARS_GLOBAL = /[\\/:*?"<>|]/g;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeFilename(name: string): string {
  let s = name.replace(ILLEGAL_CHARS_GLOBAL, '_');
  if (RESERVED.test(s)) { s += '_'; }
  return s;
}
