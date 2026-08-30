# CRM DC

Admissions CRM and partner lead-delivery platform built with React, TypeScript, Express, PostgreSQL, Prisma, S3-compatible storage, and AWS SES email OTP.

## Stack

- Web: React 18, TypeScript, Vite, Tailwind, TanStack Query
- API: Node.js 24+, TypeScript, Express 5
- Data: PostgreSQL 16 and Prisma
- Files: AWS S3 or Cloudflare R2 through presigned URLs
- Authentication: passwordless email OTP through AWS SES and signed 12-hour sessions
- Local infrastructure: Docker Compose with PostgreSQL and MinIO

## Run locally

```sh
cp .env.example .env
docker compose up -d
corepack enable
pnpm install
pnpm db:migrate
pnpm db:seed
pnpm dev
```

Open `http://localhost:8080`. The API health endpoint is `http://localhost:4000/api/health`. In development, the sign-in screen displays the generated OTP when SES is not configured.

The seeded administrator uses `BOOTSTRAP_ADMIN_EMAIL`. The included university is deliberately non-deliverable until its endpoint and credentials are replaced.

## Important commands

```sh
pnpm test
pnpm build
pnpm check
pnpm db:migrate
pnpm db:seed
pnpm db:studio
```

## Deploy

Deploy `Dockerfile.api` to a Node container service with PostgreSQL, AWS credentials, SES sender identity, and S3/R2 variables. Deploy `Dockerfile.web` or the Vite `dist` directory to Cloudflare Pages, setting `VITE_API_URL` to the public API origin. Run `pnpm db:migrate` during API release.

Production must use strong values for `JWT_SECRET`, `INBOUND_API_KEY`, and `WEBHOOK_SECRET`. Keep partner secrets, AWS credentials, the Supabase service role key, and database credentials out of `VITE_*` variables.

The API includes an in-process scheduler for due lead batches, a local rules-based AI engine, provider-specific webhook verification, and integration readiness reporting. An administrator can invoke `integration-readiness` from the compatibility client or call `POST /api/functions/integration-readiness` with a bearer token. See [production activation](docs/PRODUCTION_ACTIVATION.md) for provider-side setup that cannot be committed to source control.

## Migration

The previous Supabase implementation is preserved read-only under `legacy/supabase` for audit history. It is not imported by the runtime.

To transfer authorized source data, first deploy and migrate the target database, obtain a CRM administrator token, then run:

```sh
SOURCE_SUPABASE_URL=https://project.supabase.co \
SOURCE_SUPABASE_SERVICE_ROLE_KEY=... \
DESTINATION_API_URL=http://localhost:4000 \
DESTINATION_API_TOKEN=... \
pnpm tsx scripts/migrate-supabase-to-postgres.ts
```

The utility prints a per-table read/write/error ledger and exits nonzero on any omission. Review [the migration ledger](docs/MIGRATION_LEDGER.md) and [system wiremap](docs/SYSTEM_WIREMAP.md) before production cutover.
