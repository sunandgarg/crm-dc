import { describe, expect, it } from 'vitest';
import { buildPartnerRequest, categorizePartnerResponse } from './leadPush.js';

describe('lead push payloads', () => {
  it('builds a canonical Meritto payload with credentials and tracking', () => {
    const result = buildPartnerRequest(
      { name: 'Aarav', email: 'aarav@example.com', mobile: '9876500001', Course: 'MBA', Specialisation: 'Finance' },
      { apiUrl: 'https://example.com/leads', apiType: 'nopaperforms', collegeId: 'college-1', secretKey: 'secret-1', source: 'DekhoCampus', medium: 'CRM', campaign: 'Admissions', columnMapping: {} },
    );
    expect(result.body).toMatchObject({ name: 'Aarav', course: 'MBA', specialization: 'Finance', college_id: 'college-1', secret_key: 'secret-1', source: 'DekhoCampus' });
    expect((result.body as Record<string, string>).Course).toBeUndefined();
  });

  it('orders LeadSquared attributes and uses its tracking names', () => {
    const result = buildPartnerRequest(
      { Phone: '9876500001', FirstName: 'Meera', source: 'Website' },
      { apiUrl: 'https://example.com/leads', apiType: 'leadsquared', source: 'Fallback Source' },
    );
    expect(result.body).toEqual([
      { Attribute: 'FirstName', Value: 'Meera' },
      { Attribute: 'Phone', Value: '9876500001' },
      { Attribute: 'leadSource', Value: 'Website' },
    ]);
  });
});

describe('partner response categorization', () => {
  it('detects accepted duplicates', () => expect(categorizePartnerResponse(200, JSON.stringify({ Message: { IsCreated: false } }), true)).toBe('Duplicate'));
  it('accepts explicit success values', () => expect(categorizePartnerResponse(200, JSON.stringify({ success: true }), true)).toBe('Success'));
  it('does not treat an ambiguous 2xx response as success', () => expect(categorizePartnerResponse(200, '{}', true)).toBe('Fail'));
});
