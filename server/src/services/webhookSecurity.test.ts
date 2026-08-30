import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { validMetaSignature } from './webhookSecurity.js';

describe('Meta webhook signature verification', () => {
  it('accepts the HMAC of the exact raw request body', () => {
    const body = Buffer.from('{"entry":[{"id":"123"}]}');
    const secret = 'a-production-length-app-secret';
    const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    expect(validMetaSignature(body, signature, secret)).toBe(true);
  });

  it('rejects a signature after the body changes', () => {
    const secret = 'a-production-length-app-secret';
    const signature = `sha256=${createHmac('sha256', secret).update('original').digest('hex')}`;
    expect(validMetaSignature(Buffer.from('modified'), signature, secret)).toBe(false);
  });
});
