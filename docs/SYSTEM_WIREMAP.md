# CRM DC System Wiremap

```mermaid
flowchart LR
  U["Counsellor / Team Lead / Admin"] --> W["React + Vite web app"]
  W --> A["Express API"]
  A --> P["Prisma"]
  P --> D[("PostgreSQL")]
  A --> S["AWS S3 / Cloudflare R2"]
  A --> E["AWS SES"]
  A --> Q["Lead queue and scheduler"]
  Q --> M["Meritto / NPF"]
  Q --> L["LeadSquared"]
  Q --> X["Custom partner APIs"]
  G["Forms / Google / Meta / Netcore"] --> A
```

## Product Map

| Area | Main workflows |
| --- | --- |
| Dashboard | Lead totals, new/untouched/overdue counts, acquisition trend, pipeline, upcoming tasks, recent activity |
| Lead Push | University setup, CSV/single lead upload, mapping, queues, scheduling, retries, API logs, purge |
| Leads Manager | Saved views, quick/advanced filters, configurable columns, scoring, favourites, assignment, stages, detail drawer, CSV import/export |
| Opportunity | Configurable pipeline stages and drag-and-drop stage movement |
| Calendar / Activity | Follow-ups, tasks, calls, email, WhatsApp, meetings, notes, and completion history |
| Reports | Date-scoped stage/source/owner conversion, communication activity, task completion, and CSV export |
| Access Control | Password/OTP login, approvals, four roles, granular permissions, team scope, session revocation |
| Settings | Pipeline stage ordering/defaults/colors, teams, managers, and activation status |
| Audit | Searchable actor/action/resource ledger for lead, task, assignment, user, team, and setup changes |

## Application Routes

| Route | Surface |
| --- | --- |
| `/crm/dashboard` | Operational dashboard |
| `/crm/lead-management` | Lead table, filters, bulk actions, and lead detail |
| `/crm/opportunities` | Pipeline board |
| `/crm/tasks` | Task and follow-up queue |
| `/crm/activities` | Communication timeline |
| `/crm/analytics` | Reports and export |
| `/crm/users` | Users, roles, teams, and permissions |
| `/crm/audit` | Audit ledger |
| `/crm/settings` | Stages and teams |
| `/lead-push/*` | Preserved university lead-delivery module |

## Ownership And Access

```mermaid
flowchart TD
  SA["Super Admin"] --> ALL["All leads, users, teams, settings, reports, audit"]
  AD["Admin"] --> ALL
  TL["Team Lead"] --> TEAM["Own and team-owned leads/tasks"]
  CO["Counsellor"] --> OWN["Own leads/tasks"]
  PERM["Explicit permissions"] --> TL
  PERM --> CO
```

## Lead Lifecycle

```mermaid
stateDiagram-v2
  [*] --> Untouched
  Untouched --> Attempted
  Attempted --> Contacted
  Contacted --> FollowUp
  FollowUp --> Interested
  Interested --> ApplicationStarted
  ApplicationStarted --> ApplicationSubmitted
  ApplicationSubmitted --> Enrolled
  Untouched --> NotInterested
  Contacted --> NotInterested
  FollowUp --> Lost
  ApplicationStarted --> Lost
```

Every partner delivery records the input snapshot, status, HTTP response, source attribution, university, batch, and time. Automatic partner retries are intentionally disabled because a timed-out request may already have been accepted.
