import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import type { Request } from 'express';
import { prisma } from '../db.js';
import { asyncRoute, HttpError } from '../http.js';
import { config, isProduction } from '../config.js';

export const publicFunctionsRouter = Router();

async function record(resource: string, payload: Record<string, unknown>) {
  const id = String(payload.id || randomUUID());
  return prisma.resourceRecord.create({ data: { resource, external_id: id, payload: { ...payload, id, received_at: new Date().toISOString() } } });
}

function contactFrom(body: Record<string, any>, fallbackSource: string) {
  const source = body.lead || body.data || body;
  return {
    name: source.name || source.full_name || source.fullName || [source.first_name, source.last_name].filter(Boolean).join(' ') || 'Inbound lead',
    email: source.email || null,
    mobile: String(source.mobile || source.phone || source.phone_number || ''),
    state: source.state || null,
    city: source.city || null,
    course: source.course || source.program || null,
    specialization: source.specialization || null,
    source: source.source || fallbackSource,
    custom_fields: source,
  };
}

async function captureLead(body: Record<string, any>, source: string) {
  await record('marketing_leads', { ...body, source });
  const contact = contactFrom(body, source);
  if (contact.mobile) return prisma.crm_contacts.create({ data: contact });
  return null;
}

function assertWebhook(request: Request) {
  if (!isProduction) return;
  if (!config.WEBHOOK_SECRET) throw new HttpError(503, 'Webhook secret is not configured');
  if (request.header('x-webhook-secret') !== config.WEBHOOK_SECRET) throw new HttpError(401, 'Invalid webhook secret');
}

publicFunctionsRouter.post('/receive-lead', asyncRoute(async (request, response) => {
  const providedKey = String(request.header('x-api-key') || request.query.api_key || request.body?.api_key || '');
  const keys = await prisma.resourceRecord.findMany({ where: { resource: { in: ['url_api_keys', 'university_api_keys'] } } });
  const knownKeys = keys.map((row) => row.payload as Record<string, unknown>).filter((row) => row.is_active !== false).map((row) => String(row.api_key || row.key || ''));
  if (config.INBOUND_API_KEY) knownKeys.push(config.INBOUND_API_KEY);
  if ((knownKeys.length || isProduction) && !knownKeys.includes(providedKey)) throw new HttpError(401, 'Invalid API key');
  const contact = await captureLead(request.body || {}, String(request.body?.source || 'Landing Page API'));
  response.status(201).json({ success: true, contactId: contact?.id || null });
}));

publicFunctionsRouter.get('/meta-ads-webhook', (request, response) => {
  const challenge = request.query['hub.challenge'];
  const verifyToken = config.META_VERIFY_TOKEN;
  if (request.query['hub.mode'] === 'subscribe' && (!verifyToken || request.query['hub.verify_token'] === verifyToken)) return response.status(200).send(String(challenge || ''));
  response.sendStatus(403);
});
publicFunctionsRouter.post('/meta-ads-webhook', asyncRoute(async (request, response) => {
  assertWebhook(request);
  await record('lead_events', { provider: 'meta', payload: request.body });
  response.status(202).json({ received: true });
}));
publicFunctionsRouter.post('/google-ads-webhook', asyncRoute(async (request, response) => {
  assertWebhook(request);
  const contact = await captureLead(request.body || {}, 'Google Ads');
  response.status(202).json({ received: true, contactId: contact?.id || null });
}));
publicFunctionsRouter.post('/netcore-email-webhook', asyncRoute(async (request, response) => {
  assertWebhook(request);
  await record('email_events', { provider: 'netcore', payload: request.body });
  response.status(202).json({ received: true });
}));
publicFunctionsRouter.all('/smtp-tracking', asyncRoute(async (request, response) => {
  assertWebhook(request);
  await record('smtp_tracking_events', { method: request.method, query: request.query, payload: request.body || {} });
  response.sendStatus(204);
}));
publicFunctionsRouter.post('/url-redirect', asyncRoute(async (request, response) => {
  const code = String(request.body?.code || request.body?.short_code || '');
  const mapping = await prisma.url_mappings.findUnique({ where: { short_code: code } });
  if (!mapping?.is_active || (mapping.expires_at && mapping.expires_at < new Date())) throw new HttpError(404, 'Short link not found');
  await prisma.url_mappings.update({ where: { id: mapping.id }, data: { clicks: { increment: 1 } } });
  await record('url_clicks', { url_id: mapping.id, user_agent: request.header('user-agent') || null, referrer: request.header('referer') || null });
  response.json({ original_url: mapping.original_url, redirectTo: mapping.original_url });
}));
