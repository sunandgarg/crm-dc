import { config } from '../config.js';

export function integrationReadiness() {
  const checks = {
    scheduler: { ready: config.SCHEDULER_ENABLED, detail: config.SCHEDULER_ENABLED ? `Runs every ${config.SCHEDULER_INTERVAL_SECONDS}s` : 'Disabled by configuration' },
    ai: { ready: config.AI_MODE === 'rules' || Boolean(config.AI_API_KEY && config.AI_MODEL !== 'configure-model-name'), detail: config.AI_MODE === 'rules' ? 'Local rules engine' : 'OpenAI-compatible provider' },
    email: { ready: Boolean(config.SES_FROM_EMAIL), detail: config.SES_FROM_EMAIL ? 'SES sender configured' : 'SES sender missing' },
    storage: { ready: Boolean(config.STORAGE_BUCKET), detail: `${config.STORAGE_PROVIDER}:${config.STORAGE_BUCKET}` },
    metaWebhook: { ready: Boolean(config.META_VERIFY_TOKEN && (config.META_APP_SECRET || config.WEBHOOK_SECRET)), detail: 'Verify token and signature secret' },
    googleWebhook: { ready: Boolean(config.GOOGLE_ADS_WEBHOOK_SECRET || config.WEBHOOK_SECRET), detail: 'Provider-specific or shared secret' },
    netcoreWebhook: { ready: Boolean(config.NETCORE_WEBHOOK_SECRET || config.WEBHOOK_SECRET), detail: 'Provider-specific or shared secret' },
    inboundApi: { ready: Boolean(config.INBOUND_API_KEY), detail: 'Static key or database-managed API keys' },
  };
  return { ready: Object.values(checks).every((check) => check.ready), checkedAt: new Date().toISOString(), checks };
}
