import { z } from 'zod';
import { config } from '../config.js';
import { HttpError } from '../http.js';

type JsonObject = Record<string, unknown>;

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('score_lead'), data: z.object({ lead: z.record(z.unknown()) }) }),
  z.object({ action: z.literal('analyze_call'), data: z.object({ transcript: z.string().min(1), duration: z.coerce.number().nonnegative().default(0), contact: z.record(z.unknown()).optional() }) }),
  z.object({ action: z.literal('generate_email'), data: z.object({ template_type: z.enum(['welcome', 'follow_up', 'reminder', 'callback']).default('follow_up'), lead: z.record(z.unknown()).default({}), context: z.string().optional() }) }),
  z.object({ action: z.literal('predict_enrollment'), data: z.object({ contacts: z.array(z.record(z.unknown())).max(100) }) }),
]);

export type AiGatewayInput = z.infer<typeof actionSchema>;

function text(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function number(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recommendations(score: number, quality: string, lead: JsonObject) {
  const items = quality === 'hot'
    ? ['Priority follow-up within 1 hour', 'Assign to senior counsellor', 'Schedule campus visit']
    : quality === 'warm'
      ? ['Follow up within 24 hours', 'Send course brochure', 'Add to nurturing sequence']
      : ['Add to long-term nurturing campaign', 'Send educational content', 'Re-engage after 2 weeks'];
  if (!lead.email) items.push('Collect email address');
  if (!lead.course) items.push('Identify course interest');
  return items;
}

export function scoreLead(lead: JsonObject) {
  let score = 35;
  const email = text(lead.email).toLowerCase();
  const mobile = text(lead.mobile);
  const source = text(lead.source).toLowerCase();
  if (email) score += 8;
  if (email.endsWith('.edu') || email.endsWith('.ac.in')) score += 7;
  if (/^(\+91)?[6-9]\d{9}$/.test(mobile.replace(/[\s-]/g, ''))) score += 10;
  if (lead.city) score += 5;
  if (lead.state) score += 5;
  if (lead.course) score += 10;
  if (['google', 'linkedin', 'referral'].some((value) => source.includes(value))) score += 15;
  if (lead.last_contacted_at) score += 5;
  score = Math.min(score, 100);
  const quality = score >= 80 ? 'hot' : score >= 50 ? 'warm' : 'cold';
  return { success: true, score, quality, recommendations: recommendations(score, quality, lead), mode: 'rules' };
}

function analyzeCallRules(transcript: string, duration: number) {
  const normalized = transcript.toLowerCase();
  const positives = ['interested', 'yes', 'good', 'great', 'thank', 'happy', 'enroll', 'admission'];
  const negatives = ['not interested', 'expensive', 'later', 'busy', "don't call", 'do not call'];
  const positiveSignals = positives.filter((word) => normalized.includes(word)).length;
  const negativeSignals = negatives.filter((word) => normalized.includes(word)).length;
  const sentiment = positiveSignals > negativeSignals ? 'positive' : negativeSignals > positiveSignals ? 'negative' : 'neutral';
  const outcome = positiveSignals >= 3 ? 'interested' : negativeSignals >= 2 ? 'not_interested' : 'follow_up_needed';
  const suggestedAction = outcome === 'interested'
    ? 'Schedule a campus visit or send the application link'
    : outcome === 'not_interested'
      ? 'Respect communication preferences and add to an eligible re-engagement segment'
      : sentiment === 'positive' ? 'Follow up with course details' : sentiment === 'negative' ? 'Send a soft-touch email after one week' : 'Schedule a follow-up call in three days';
  return {
    sentiment,
    outcome,
    positive_signals: positiveSignals,
    negative_signals: negativeSignals,
    duration_quality: duration > 180 ? 'good' : duration > 60 ? 'average' : 'short',
    suggested_next_action: suggestedAction,
  };
}

function generatedEmail(templateType: string, lead: JsonObject) {
  const name = text(lead.name) || 'Student';
  const course = text(lead.course) || 'your selected program';
  const university = text(lead.university) || 'Our Institution';
  const templates: Record<string, { subject: string; content: string }> = {
    welcome: { subject: `Welcome to ${university}`, content: `Dear ${name},\n\nThank you for your interest in our programs. Our admissions counsellor will contact you shortly to understand your goals and guide you through the next steps.\n\nBest regards,\nAdmissions Team` },
    follow_up: { subject: `A quick follow-up about ${course}`, content: `Hi ${name},\n\nI wanted to follow up on your enquiry about ${course}. Please reply with any questions, or share a convenient time for a call.\n\nBest regards,\nAdmissions Team` },
    reminder: { subject: 'Your application is awaiting completion', content: `Dear ${name},\n\nThis is a reminder to complete your application for ${course}. Please contact us if you need help with documents or any step in the process.\n\nBest regards,\nAdmissions Team` },
    callback: { subject: 'Confirming your requested callback', content: `Hi ${name},\n\nWe are ready to call you about ${course}. Please reply with your preferred date and time.\n\nBest regards,\nAdmissions Team` },
  };
  return { success: true, ...templates[templateType], mode: 'rules' };
}

function enrollmentPredictions(contacts: JsonObject[]) {
  return contacts.map((contact) => {
    let probability = 30;
    const score = number(contact.lead_score);
    if (score >= 80) probability += 30;
    else if (score >= 50) probability += 15;
    if (number(contact.activities_count) > 5) probability += 10;
    if (number(contact.email_opens) > 3) probability += 10;
    if (['qualified', 'negotiation', 'application'].includes(text(contact.stage).toLowerCase())) probability += 15;
    probability = Math.min(probability, 95);
    return { contact_id: contact.id, name: contact.name, probability, confidence: probability > 70 ? 'high' : probability > 40 ? 'medium' : 'low' };
  });
}

async function modelJson(system: string, payload: unknown) {
  if (!config.AI_API_KEY || config.AI_MODEL === 'configure-model-name') throw new HttpError(503, 'AI model credentials are not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.AI_TIMEOUT_SECONDS * 1000);
  try {
    const serialized = JSON.stringify(payload).slice(0, config.AI_MAX_INPUT_CHARS);
    const response = await fetch(`${config.AI_API_URL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.AI_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.AI_MODEL, temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: serialized }] }),
      signal: controller.signal,
    });
    if (!response.ok) throw new HttpError(502, `AI provider failed with status ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new HttpError(502, 'AI provider returned an empty response');
    return JSON.parse(content) as JsonObject;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(502, error instanceof Error && error.name === 'AbortError' ? 'AI provider timed out' : 'AI provider returned invalid JSON');
  } finally {
    clearTimeout(timer);
  }
}

export async function runAiGateway(input: unknown) {
  const parsed = actionSchema.parse(input);
  if (parsed.action === 'score_lead') return scoreLead(parsed.data.lead);
  if (parsed.action === 'predict_enrollment') return { success: true, predictions: enrollmentPredictions(parsed.data.contacts), mode: 'rules' };
  if (parsed.action === 'analyze_call') {
    if (config.AI_MODE === 'rules') return { success: true, analysis: analyzeCallRules(parsed.data.transcript, parsed.data.duration), mode: 'rules' };
    const analysis = await modelJson('Analyze this admissions call. Return JSON with sentiment, outcome, positive_signals, negative_signals, duration_quality, and suggested_next_action. Do not include markdown.', parsed.data);
    return { success: true, analysis, mode: 'openai_compatible' };
  }
  if (config.AI_MODE === 'rules') return generatedEmail(parsed.data.template_type, parsed.data.lead);
  const generated = await modelJson('Write a concise, factual admissions email. Return JSON with subject and content. Do not invent fees, deadlines, rankings, or guarantees.', parsed.data);
  return { success: true, subject: text(generated.subject), content: text(generated.content), mode: 'openai_compatible' };
}
