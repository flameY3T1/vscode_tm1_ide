/**
 * Decode a TM1 server-side text file. TM1's `ASCIIOutput`/`TextOutput` both write
 * in the server's OS codepage (Windows-1252 on German/Western installs — `ä`=0xE4,
 * a single byte), NOT UTF-8, and `ErrorLogFiles/Content` returns `text/plain` with
 * no charset. Try strict UTF-8 first (covers UTF-8 servers, v12, and pure ASCII);
 * on any invalid byte fall back to Windows-1252 so umlauts survive round-trip.
 * (Live-verified TM1 11.8: op-log bytes came back Latin-1.)
 */
/** Windows-1252 characters in 0x80–0x9F that differ from ISO-8859-1 (control
 *  chars there). Node's `TextDecoder('windows-1252')` is unreliable across builds,
 *  so we decode Latin-1 (fast, always available) and fix up just this range. */
const WIN1252_HIGH: Record<number, string> = {
  0x80: '€', 0x82: '‚', 0x83: 'ƒ', 0x84: '„', 0x85: '…', 0x86: '†', 0x87: '‡',
  0x88: 'ˆ', 0x89: '‰', 0x8a: 'Š', 0x8b: '‹', 0x8c: 'Œ', 0x8e: 'Ž', 0x91: '‘',
  0x92: '’', 0x93: '“', 0x94: '”', 0x95: '•', 0x96: '–', 0x97: '—',
  0x98: '˜', 0x99: '™', 0x9a: 'š', 0x9b: '›', 0x9c: 'œ', 0x9e: 'ž', 0x9f: 'Ÿ',
};

export function decodeServerText(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Windows-1252: Latin-1 for 0xA0–0xFF (umlauts), plus the 0x80–0x9F fixups.
    return buf
      .toString('latin1')
      .replace(/[\x80-\x9f]/g, (c) => WIN1252_HIGH[c.charCodeAt(0)] ?? c);
  }
}
