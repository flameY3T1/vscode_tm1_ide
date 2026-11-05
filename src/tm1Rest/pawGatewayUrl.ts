export type PawGatewayErrorCode = 'url' | 'response' | 'http' | 'timeout' | 'tenant';

export class PawGatewayError extends Error {
  constructor(
    message: string,
    public readonly code: PawGatewayErrorCode,
    public readonly statusCode?: number,
  ) {
    super(message);
    this.name = 'PawGatewayError';
  }
}

/** Accept only an HTTP(S) origin. PAW path prefixes are not supported. */
export function normalizePawGatewayUrl(url: string): string {
  const value = url.trim();
  if (!/^https?:\/\/[^/?#]+\/*$/i.test(value)
    || value.includes('\\') || value.includes('@') || /[\u0000-\u0020\u007f]/u.test(value)) {
    throw new PawGatewayError('PAW gateway URL must be an HTTP(S) root URL', 'url');
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PawGatewayError('PAW gateway URL is invalid', 'url');
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    || !parsed.hostname || parsed.username || parsed.password
    || parsed.search || parsed.hash || !/^\/+$/u.test(parsed.pathname)) {
    throw new PawGatewayError('PAW gateway URL must be an HTTP(S) root URL', 'url');
  }
  return `${parsed.protocol}//${parsed.host}`;
}

export function encodePawInstanceName(name: string): string {
  if (name.trim() === '' || name === '.' || name === '..') {
    throw new PawGatewayError('PAW instance name is invalid', 'response');
  }
  try {
    return encodeURIComponent(name);
  } catch {
    throw new PawGatewayError('PAW instance name is invalid', 'response');
  }
}
