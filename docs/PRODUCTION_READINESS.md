# Production Readiness

## Release gate

1. Set `NODE_ENV=production`, an HTTPS `APP_URL`, and a random `JWT_SECRET` of at least 48 characters.
2. Configure PostgreSQL with automated point-in-time recovery and run `pnpm db:migrate` as a release step.
3. Set `BOOTSTRAP_ADMIN_EMAIL`, run `pnpm db:seed` once, then remove bootstrap permissions from routine deployments.
4. Verify an AWS SES identity and set `SES_FROM_EMAIL` plus AWS credentials or workload identity.
5. Configure S3 or R2 private storage. Production startup rejects `STORAGE_PUBLIC_BASE_URL`.
6. Configure all webhook secrets and `INBOUND_API_KEY`; rotate any values that were used outside the secret manager.
7. Keep `ALLOW_PRIVATE_PARTNER_URLS=false` and `ALLOW_HTTP_PARTNER_URLS=false` unless a reviewed private network integration requires an exception.
8. Set `TRUST_PROXY=true` only behind a trusted single-hop reverse proxy.
9. Run `pnpm check`, `pnpm audit --prod --audit-level high`, migration tests, and an authenticated browser smoke test.
10. Confirm alerts for API 5xx rate, readiness failures, queue failures, SES delivery failures, and database/storage capacity.

## Backup drill

Run `scripts/backup-postgres.sh`, restore into an isolated database with `CONFIRM_RESTORE=RESTORE scripts/restore-postgres.sh <dump>`, and validate row counts plus an authenticated read. Repeat the restore drill at least quarterly.

## Rollback

Deploy the previous immutable API and web images. Prisma migrations in this repository are forward-only; create and test an explicit corrective migration for schema rollback. Do not restore a database backup over a live environment without an approved incident plan.

## Scaling notes

The scheduler uses database claims and stale-job recovery. Run one scheduler-enabled instance per environment; set `SCHEDULER_ENABLED=false` on other API replicas. Request rate counters are instance-local, so enforce a second distributed limit at the load balancer or edge when running multiple replicas.
