import { beforeAll, describe, expect, it } from 'vitest';

let otp: typeof import('./otp.js');

beforeAll(async () => {
  process.env.DATABASE_URL = 'postgresql://crm:crm@localhost:5432/crm_dc';
  process.env.JWT_SECRET = 'test-secret-that-is-at-least-thirty-two-characters';
  otp = await import('./otp.js');
});

describe('email OTP security', () => {
  it('creates a six digit code', () => expect(otp.generateOtp()).toMatch(/^\d{6}$/));
  it('hashes codes and rejects a different code', async () => {
    const hash = await otp.hashOtp('123456');
    expect(hash).not.toContain('123456');
    await expect(otp.verifyOtpHash('123456', hash)).resolves.toBe(true);
    await expect(otp.verifyOtpHash('654321', hash)).resolves.toBe(false);
  });
});
