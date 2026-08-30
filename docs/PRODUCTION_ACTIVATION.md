# Production Activation

This runbook covers the provider-side switches that cannot be stored in Git. AWS hosting and the Supabase data migration are intentionally outside this checklist.

## 1. Secrets

Generate independent values for `JWT_SECRET`, `INBOUND_API_KEY`, `WEBHOOK_SECRET`, `META_APP_SECRET`, `GOOGLE_ADS_WEBHOOK_SECRET`, and `NETCORE_WEBHOOK_SECRET`. Store them in the API runtime secret manager, never in `VITE_*` variables.

## 2. Webhooks

Use the public API origin in these provider dashboards:

| Provider | Callback | Verification |
| --- | --- | --- |
| Meta | `POST /api/functions/meta-ads-webhook` | `X-Hub-Signature-256` using `META_APP_SECRET`; verification GET uses `META_VERIFY_TOKEN` |
| Google Ads | `POST /api/functions/google-ads-webhook` | `X-Google-Webhook-Secret` or bearer token |
| Netcore | `POST /api/functions/netcore-email-webhook` | `X-Netcore-Webhook-Secret` or bearer token |
| SMTP tracking | `/api/functions/smtp-tracking` | `X-Webhook-Secret` or bearer token |
| Landing pages | `POST /api/functions/receive-lead` | `X-API-Key` or bearer token |

Production fails closed when a required secret is missing or invalid. Query-string API keys are deliberately rejected to keep credentials out of access logs.

## 3. Storage

Create an S3-compatible bucket, issue credentials limited to that bucket, apply [CORS](../infra/storage/cors.json) and [lifecycle](../infra/storage/lifecycle.json), then set the `STORAGE_*` variables. Validate this sequence as an authenticated user:

1. Request `POST /api/storage/presign-upload`.
2. Upload the exact declared bytes to the returned URL.
3. Call `POST /api/storage/{assetId}/complete`.
4. Request `GET /api/storage/{assetId}/download`.

Only the owner or an administrator can generate a download URL.

## 4. Email OTP

Verify `SES_FROM_EMAIL`, grant send permission, and move the SES account out of sandbox when real recipients must sign in. Test both OTP delivery and the generic response for unknown users.

## 5. AI

`AI_MODE=rules` is production-capable and keeps data inside the API. To opt into an external OpenAI-compatible provider, complete privacy and budget approval, then set `AI_MODE=openai_compatible`, `AI_API_URL`, `AI_MODEL`, and `AI_API_KEY`.

## 6. Partner Acceptance

Replace the seed university URL and credentials with each partner's approved sandbox values. Test success, duplicate, validation failure, timeout, pause/cancel, daily limit, and a scheduled batch before enabling live delivery. Automatic retries remain disabled because a timed-out partner request may already have created a lead.

## 7. Final Gate

Call `GET /api/readiness`, then call `POST /api/functions/integration-readiness` using an administrator bearer token. Do not cut over until required checks are ready and the partner sandbox evidence is retained.
