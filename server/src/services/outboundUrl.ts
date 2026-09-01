import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { config, isProduction } from '../config.js';
import { HttpError } from '../http.js';

function privateAddress(address: string) {
  const value = address.toLowerCase().replace(/^\[|\]$/g, '');
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (mapped.includes('.')) return privateAddress(mapped);
    const [high, low] = mapped.split(':').map((part) => Number.parseInt(part, 16));
    if (Number.isFinite(high) && Number.isFinite(low)) return privateAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    return true;
  }
  if (value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return true;
  const parts = value.split('.').map(Number);
  if (parts.length !== 4) return false;
  return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && [0, 2, 168].includes(parts[1])) || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19 || parts[1] === 51)) || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) || parts[0] >= 224;
}

export async function assertSafeOutboundUrl(input: string) {
  let url: URL;
  try { url = new URL(input); } catch { throw new HttpError(400, 'A valid partner URL is required'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new HttpError(400, 'Partner URL must be an HTTP(S) URL without embedded credentials');
  if (isProduction && url.protocol !== 'https:' && !config.ALLOW_HTTP_PARTNER_URLS) throw new HttpError(400, 'Partner URL must use HTTPS in production');
  if (config.ALLOW_PRIVATE_PARTNER_URLS) return url;
  if (url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new HttpError(400, 'Private partner addresses are not allowed');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: Array<{ address: string }>;
  try { addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true }); }
  catch { throw new HttpError(400, 'Partner URL hostname could not be resolved'); }
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new HttpError(400, 'Private partner addresses are not allowed');
  return url;
}
