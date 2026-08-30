import { describe, expect, it } from 'vitest';
import { runAiGateway, scoreLead } from './ai.js';

describe('AI gateway rules engine', () => {
  it('scores a complete high-intent admissions lead', () => {
    const result = scoreLead({ email: 'student@college.ac.in', mobile: '9876543210', city: 'Jaipur', state: 'Rajasthan', course: 'MBA', source: 'Google Search', last_contacted_at: new Date().toISOString() });
    expect(result.success).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.quality).toBe('hot');
  });

  it('returns the existing call-analysis response contract', async () => {
    const result = await runAiGateway({ action: 'analyze_call', data: { transcript: 'Yes, I am interested and happy to enroll. Thank you.', duration: 220 } });
    expect(result).toMatchObject({ success: true, mode: 'rules', analysis: { sentiment: 'positive', outcome: 'interested', duration_quality: 'good' } });
  });

  it('generates a factual email without an external provider', async () => {
    const result = await runAiGateway({ action: 'generate_email', data: { template_type: 'follow_up', lead: { name: 'Asha', course: 'MBA' } } });
    expect(result).toMatchObject({ success: true, mode: 'rules' });
    expect('subject' in result && result.subject).toContain('MBA');
  });

  it('limits enrollment prediction requests to 100 contacts', async () => {
    await expect(runAiGateway({ action: 'predict_enrollment', data: { contacts: Array.from({ length: 101 }, (_, id) => ({ id })) } })).rejects.toThrow();
  });
});
