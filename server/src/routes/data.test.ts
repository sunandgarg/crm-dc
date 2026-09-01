import { describe, expect, it } from 'vitest';
import { secureQuery } from './data.js';

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'user@example.com', role: 'counsellor', full_name: 'User', sessionVersion: 0 };

describe('compatibility data authorization', () => {
  it('denies administrative resources to regular users', () => {
    expect(() => secureQuery('user_roles', { action: 'select' }, user)).toThrow('Resource access denied');
  });

  it('forces ownership on batch reads and inserts', () => {
    const read = secureQuery('upload_batches', { action: 'select' }, user);
    expect(read.body.filters).toContainEqual({ column: 'user_id', operator: 'eq', value: user.id });
    const insert = secureQuery('upload_batches', { action: 'insert', data: { file_name: 'leads.csv', user_id: 'attacker' } }, user);
    expect(insert.body.data).toMatchObject({ user_id: user.id });
  });

  it('rejects unfiltered mutations', () => {
    const admin = { ...user, role: 'admin' };
    expect(() => secureQuery('universities', { action: 'delete' }, admin)).toThrow('filtered mutation');
  });

  it('only exposes the operational rate setting to regular users', () => {
    expect(() => secureQuery('app_settings', { action: 'select' }, user)).toThrow('Setting access denied');
    expect(() => secureQuery('app_settings', { action: 'select', filters: [{ column: 'key', operator: 'eq', value: 'ad_integration_meta' }] }, user)).toThrow('Setting access denied');
    expect(secureQuery('app_settings', { action: 'select', filters: [{ column: 'key', operator: 'eq', value: 'rate_limit_config' }] }, user).body.filters).toHaveLength(1);
  });
});
