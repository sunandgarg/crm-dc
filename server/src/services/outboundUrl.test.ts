import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl } from './outboundUrl.js';

describe('outbound URL policy', () => {
  it('rejects localhost and loopback targets', async () => {
    await expect(assertSafeOutboundUrl('http://localhost/admin')).rejects.toThrow('Private partner addresses');
    await expect(assertSafeOutboundUrl('http://127.0.0.1/admin')).rejects.toThrow('Private partner addresses');
    await expect(assertSafeOutboundUrl('http://[::ffff:127.0.0.1]/admin')).rejects.toThrow('Private partner addresses');
  });

  it('rejects embedded credentials and non-HTTP protocols', async () => {
    await expect(assertSafeOutboundUrl('https://user:pass@example.com')).rejects.toThrow('without embedded credentials');
    await expect(assertSafeOutboundUrl('file:///etc/passwd')).rejects.toThrow('HTTP(S)');
  });
});
