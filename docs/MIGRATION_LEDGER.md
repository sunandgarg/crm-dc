# Migration Ledger

Updated: 30 August 2026

## Completed

- React + TypeScript + Vite frontend retained and connected to the new HTTP API.
- Supabase runtime client replaced by a compatible Express data/auth/functions adapter.
- Node.js + TypeScript + Express API with validation, structured logging, security headers, CORS, and centralized errors.
- PostgreSQL Prisma schema and initial SQL migration for users, OTPs, universities, batches, leads, API logs, CRM, tasks, activities, automation, campaigns, links, access control, files, and audit logs.
- Flexible `resource_records` bridge for lower-traffic legacy modules while their screens remain usable.
- AWS SES OTP request/verification, hashed single-use codes, attempt limits, expiry, request throttling, and JWT sessions.
- AWS S3 and Cloudflare R2 compatible presigned upload/download service.
- Partner lead delivery with mapping, fixed/static/dynamic values, Meritto normalization, LeadSquared attributes, custom headers, bearer/custom auth, wrappers, pause/cancel guard, daily limit, timeout, duplicate classification, logs, and batch counters.
- Lead queue, scheduled batches, cleanup, CRM synchronization, university purge, API configuration test, custom integration test, DNS check, server IP, database export/import, URL resolution, and SES send endpoints.
- Inbound landing-page, Google Ads, Meta Ads, Netcore, and tracking ingestion endpoints with production secrets.
- Admin user approval, role, permission, revocation, and user creation workflows adapted to OTP authentication.
- CRM merge: saved views, favourites, lead drawer, editable stage/priority/owner, activity timeline/composer, CSV import/export, bulk assignment/stage change, table and Kanban.
- Seed dataset, Docker local infrastructure, production Dockerfiles, CI, unit tests, migration utility, and archived Supabase source.

## Compatibility Bridge

These resources currently use JSON-backed `resource_records` rather than dedicated Prisma tables: app settings, automation logs, campaign KPIs/recipients, custom domains, DLT entities, email delivery resources, forms, funnels, landing pages, assignment/scoring/segmentation records, marketing integrations/sequences/workflows/templates, SMTP operational records, team members, university/API keys, URL click/import records, and related event streams.

The API allowlist is explicit. Unknown resources fail with `404`; unknown legacy function names fail with `501` and a reference. Nothing falls through as a false success.

## Requires Deployment Input

- Real Supabase/customer data was not copied. Run the provided migration utility only with authorization and inspect its per-resource ledger.
- AWS SES needs a verified sender/domain, production access, region, and IAM permission.
- S3/R2 needs a bucket, CORS policy, lifecycle rules, and scoped credentials. MinIO is local-only.
- Meta/Google/Netcore webhook subscriptions and signatures must be configured in each provider account.
- Stable outbound partner allowlisting requires fixed egress infrastructure; an Express request IP is not an egress guarantee.
- AI features return explicit `501` until a model provider, privacy policy, budget, and API credential are selected.
- Existing Supabase Auth password hashes cannot be exported. Users sign in through OTP; provision the approved user list through admin or an authorized identity export.
- Production scheduling needs a cron/queue trigger for `process-scheduled-batches`; the endpoint is implemented but no cloud scheduler was created.
- Provider acceptance testing must use partner-approved sandbox endpoints. The seed partner URL and secrets are intentionally placeholders.

## Cutover Gate

Do not switch production traffic until migrations, seed/admin provisioning, SES delivery, storage upload/download, partner sandbox delivery, webhook authentication, backup/restore, migration ledger reconciliation, and rollback rehearsal all pass in staging.
