import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { config, isProduction } from '../config.js';
import { HttpError } from '../http.js';

export type WebhookProvider = 'meta' | 'google' | 'netcore' | 'smtp';
export type RawRequest = Request & { rawBody?: Buffer };

function safeEqual(left: string, right: string) {
  const leftDigest = createHash('sha256').update(left).digest();
  const rightDigest = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function validMetaSignature(rawBody: Buffer, signature: string, appSecret: string) {
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return safeEqual(expected, signature);
}

function suppliedSecret(request: Request, provider: WebhookProvider) {
  const providerHeader = provider === 'google' ? 'x-google-webhook-secret' : provider === 'netcore' ? 'x-netcore-webhook-secret' : 'x-webhook-secret';
  const authorization = request.header('authorization');
  return request.header(providerHeader) || request.header('x-webhook-secret') || (authorization?.startsWith('Bearer ') ? authorization.slice(7) : '');
}

export function assertProviderWebhook(request: RawRequest, provider: WebhookProvider) {
  if (provider === 'meta' && config.META_APP_SECRET) {
    const signature = request.header('x-hub-signature-256') || '';
    if (!request.rawBody || !validMetaSignature(request.rawBody, signature, config.META_APP_SECRET)) throw new HttpError(401, 'Invalid Meta webhook signature');
    return;
  }
  const providerSecret = provider === 'google' ? config.GOOGLE_ADS_WEBHOOK_SECRET : provider === 'netcore' ? config.NETCORE_WEBHOOK_SECRET : config.WEBHOOK_SECRET;
  const expected = providerSecret || config.WEBHOOK_SECRET;
  if (!expected) {
    if (isProduction) throw new HttpError(503, `${provider} webhook secret is not configured`);
    return;
  }
  if (!safeEqual(suppliedSecret(request, provider), expected)) throw new HttpError(401, `Invalid ${provider} webhook secret`);
}
