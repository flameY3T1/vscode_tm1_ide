import { describe, expect, it, vi } from 'vitest';
vi.mock('vscode', async () => await import('../__mocks__/vscode'));
import { describePawError } from '../../utils/pawErrorText';
import { PawGatewayError } from '../../tm1Rest/pawGatewayUrl';

describe('PAW error messages', () => {
  it('names the gateway configuration on HTTP errors, not the login', () => {
    // The list is fetched anonymously — a login hint would be misleading.
    for (const status of [401, 403]) {
      const text = describePawError(new PawGatewayError('secret response', 'http', status), 'https://paw');
      expect(text).toContain(`HTTP ${status}`);
      expect(text).not.toContain('login');
      expect(text).not.toContain('secret response');
    }
  });
  it('keeps connection failures distinct from malformed responses', () => {
    expect(describePawError(Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }), 'https://paw')).toContain('refused');
    expect(describePawError(new PawGatewayError('bad json', 'response'), 'https://paw')).toContain('invalid or incomplete');
    expect(describePawError(new PawGatewayError('deadline', 'timeout'), 'https://paw')).toContain('timed out');
  });
});
