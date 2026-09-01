import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { optionalAuth } from "../middleware/auth.js";
import { config } from "../config.js";
import { z } from "zod";
import type { AuthUser } from "../types.js";
import { logger } from "../logger.js";

const resources = new Set(`api_logs app_settings automation_logs automation_rules campaign_kpis campaign_recipients course_specializations crm_activities crm_contacts crm_tasks custom_column_values custom_columns custom_domains dlt_entities email_api_settings email_campaigns email_events email_recipients email_templates feature_toggles form_submissions funnel_campaign_contacts funnel_campaigns landing_pages lead_assignment_history lead_assignment_rules lead_capture_forms lead_events lead_push_cumulative_stats lead_push_daily_stats lead_scoring_rules lead_segment_members lead_segments leads marketing_campaigns marketing_custom_integrations marketing_integrations marketing_leads marketing_sequence_steps marketing_sequences marketing_templates marketing_workflows multi_push_presets pipeline_stages profiles programs smtp_campaigns smtp_domains smtp_email_logs smtp_link_clicks smtp_links smtp_suppression_list smtp_templates smtp_tracking_events state_cities team_members universities university_api_keys upload_batches url_api_keys url_bulk_imports url_clicks url_mappings user_permissions user_roles`.split(" "));

const delegates = new Set(`api_logs automation_rules course_specializations crm_activities crm_contacts crm_tasks custom_column_values custom_columns feature_toggles leads marketing_campaigns pipeline_stages profiles programs state_cities universities upload_batches url_mappings user_permissions user_roles`.split(" "));

type Filter = { column: string; operator: string; value: unknown };
type QueryBody = {
  action?: "select" | "insert" | "update" | "upsert" | "delete";
  data?: unknown;
  filters?: Filter[];
  order?: { column: string; ascending?: boolean }[];
  limit?: number;
  offset?: number;
  single?: boolean;
  maybeSingle?: boolean;
  count?: "exact";
  head?: boolean;
  select?: string;
  onConflict?: string;
};

const querySchema = z.object({
  action: z.enum(["select", "insert", "update", "upsert", "delete"]).default("select"),
  data: z.unknown().optional(),
  filters: z.array(z.object({ column: z.string().regex(/^(?:[a-zA-Z][a-zA-Z0-9_]*|__or)$/), operator: z.string().max(20), value: z.unknown() })).max(50).default([]),
  order: z.array(z.object({ column: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/), ascending: z.boolean().optional() })).max(10).optional(),
  limit: z.number().int().min(1).max(config.MAX_QUERY_ROWS).default(config.MAX_QUERY_ROWS),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  single: z.boolean().optional(), maybeSingle: z.boolean().optional(), count: z.literal("exact").optional(), head: z.boolean().optional(),
  select: z.string().max(5000).optional(), onConflict: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]*$/).optional(),
}).strict();

const userReadable = new Set(["universities", "programs", "state_cities", "course_specializations", "custom_columns", "custom_column_values", "upload_batches", "app_settings", "feature_toggles"]);
const userWritable = new Set(["upload_batches"]);
const sensitiveUniversityFields = new Set(["secret_key", "auth_header_key", "auth_header_value", "custom_headers", "default_values", "column_mapping", "sample_csv_content"]);

export function secureQuery(resource: string, input: QueryBody, user: AuthUser) {
  const body = { ...input, filters: [...(input.filters ?? [])] };
  const admin = ["admin", "super_admin"].includes(user.role);
  if (!admin) {
    if (!userReadable.has(resource)) throw new HttpError(403, "Resource access denied");
    if (body.action !== "select" && !userWritable.has(resource)) throw new HttpError(403, "Resource is read-only");
    if (resource === "upload_batches") {
      body.filters.push({ column: "user_id", operator: "eq", value: user.id });
      if (body.action === "insert") {
        const rows = Array.isArray(body.data) ? body.data : [body.data];
        const ownedRows = rows.map((row) => ({ ...(row as object), user_id: user.id }));
        body.data = Array.isArray(input.data) ? ownedRows : ownedRows[0];
      }
      if (body.action === "upsert") throw new HttpError(403, "Upsert requires administrator access");
    }
    if (resource === "app_settings" && !body.filters.some((filter) => filter.column === "key" && filter.operator === "eq" && filter.value === "rate_limit_config")) throw new HttpError(403, "Setting access denied");
  }
  if (["update", "delete"].includes(body.action ?? "select") && !body.filters.length) throw new HttpError(400, "A filtered mutation is required");
  return { body, admin };
}

function redactUniversity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUniversity);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !sensitiveUniversityFields.has(key)).map(([key, item]) => [key, redactUniversity(item)]));
}

function ensureResource(resource: string) {
  if (!resources.has(resource)) throw new HttpError(404, `Unknown data resource: ${resource}`);
}

function whereFrom(filters: Filter[] = []) {
  const where: Record<string, unknown> = {};
  const AND: Record<string, unknown>[] = [];
  filters.forEach(({ column, operator, value }) => {
    if (operator === "or") {
      const clauses = String(value).replace(/^\(|\)$/g, "").split(",").map((part) => {
        const [field, comparison, ...rest] = part.split(".");
        const expected = rest.join(".").replaceAll("%", "");
        return comparison === "ilike" || comparison === "like"
          ? { [field]: { contains: expected, ...(comparison === "ilike" ? { mode: "insensitive" } : {}) } }
          : { [field]: comparison === "eq" ? expected : { [comparison]: expected } };
      });
      AND.push({ OR: clauses });
      return;
    }
    if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(column)) throw new HttpError(400, "Invalid filter column");
    if (operator === "eq" || operator === "is") where[column] = value;
    else if (operator === "neq") where[column] = { not: value };
    else if (["gt", "gte", "lt", "lte", "contains", "in"].includes(operator)) where[column] = { [operator]: value };
    else if (operator === "like" || operator === "ilike") where[column] = { contains: String(value).replaceAll("%", ""), ...(operator === "ilike" ? { mode: "insensitive" } : {}) };
    else if (operator === "not") AND.push({ NOT: { [column]: value } });
  });
  return AND.length ? { ...where, AND } : where;
}

function delegateFor(resource: string) {
  return (prisma as unknown as Record<string, PrismaClient[keyof PrismaClient]>)[resource] as any;
}

function relationInclude(resource: string, selection = "") {
  if (resource === "leads" && selection.includes("universit")) return { university: true, batch: true };
  if (resource === "crm_contacts" && selection.includes("pipeline_stage")) return { pipeline_stage: true, university: true };
  if (resource === "api_logs" && selection.includes("universit")) return { university: true };
  return undefined;
}

function normalizeRelations(resource: string, row: any) {
  if (!row || typeof row !== "object") return row;
  const normalized = { ...row };
  if (normalized.university) normalized.universities = normalized.university;
  if (resource === "crm_contacts" && normalized.pipeline_stage) normalized.pipeline_stages = normalized.pipeline_stage;
  return normalized;
}

function payloadMatches(payload: Record<string, unknown>, filters: Filter[] = []) {
  return filters.every(({ column, operator, value }) => {
    const actual = payload[column];
    if (operator === "or") return String(value).replace(/^\(|\)$/g, "").split(",").some((part) => {
      const [field, comparison, ...rest] = part.split(".");
      const expected = rest.join(".").replaceAll("%", "");
      const item = String(payload[field] ?? "");
      return comparison === "ilike" ? item.toLowerCase().includes(expected.toLowerCase()) : comparison === "like" ? item.includes(expected) : item === expected;
    });
    if (operator === "eq" || operator === "is") return actual === value;
    if (operator === "neq" || operator === "not") return actual !== value;
    if (operator === "in") return Array.isArray(value) && value.includes(actual);
    if (operator === "contains") return Array.isArray(actual) ? actual.includes(value) : String(actual ?? "").includes(String(value));
    if (operator === "like" || operator === "ilike") return String(actual ?? "").toLowerCase().includes(String(value).replaceAll("%", "").toLowerCase());
    if (operator === "gt") return Number(actual) > Number(value);
    if (operator === "gte") return Number(actual) >= Number(value);
    if (operator === "lt") return Number(actual) < Number(value);
    if (operator === "lte") return Number(actual) <= Number(value);
    return true;
  });
}

async function firstClass(resource: string, body: QueryBody) {
  const delegate = delegateFor(resource);
  const where = whereFrom(body.filters);
  const include = relationInclude(resource, body.select);
  const rows = Array.isArray(body.data) ? body.data : [body.data];
  if (body.action === "insert") {
    const data = await Promise.all(rows.filter(Boolean).map((row) => delegate.create({ data: row })));
    return Array.isArray(body.data) ? data : data[0];
  }
  if (body.action === "upsert") {
    const conflict = body.onConflict || "id";
    const data = await Promise.all(rows.filter(Boolean).map((row: any) => delegate.upsert({ where: { [conflict]: row[conflict] }, create: row, update: row })));
    return Array.isArray(body.data) ? data : data[0];
  }
  if (body.action === "update") {
    await delegate.updateMany({ where, data: body.data });
    const data = await delegate.findMany({ where, include });
    return body.single || body.maybeSingle ? data[0] ?? null : data;
  }
  if (body.action === "delete") {
    const data = await delegate.findMany({ where, include });
    await delegate.deleteMany({ where });
    return body.single || body.maybeSingle ? data[0] ?? null : data;
  }

  const orderBy = body.order?.map((entry) => ({ [entry.column]: entry.ascending === false ? "desc" : "asc" }));
  const options = { where, include, orderBy, skip: body.offset, take: body.limit };
  const [data, count] = await Promise.all([
    body.head ? Promise.resolve([]) : delegate.findMany(options),
    body.count === "exact" ? delegate.count({ where }) : Promise.resolve(null),
  ]);
  const normalized = data.map((row: any) => normalizeRelations(resource, row));
  return { data: body.single || body.maybeSingle ? normalized[0] ?? null : normalized, count };
}

async function flexible(resource: string, body: QueryBody) {
  const existing = await prisma.resourceRecord.findMany({ where: { resource }, orderBy: { created_at: "desc" }, take: config.MAX_FLEXIBLE_SCAN_ROWS });
  const matching = existing.filter((row) => payloadMatches(row.payload as Record<string, unknown>, body.filters));
  const rows = Array.isArray(body.data) ? body.data : [body.data];
  if (body.action === "insert") {
    const data = await Promise.all(rows.filter(Boolean).map((item: any) => {
      const id = item.id || randomUUID();
      return prisma.resourceRecord.create({ data: { resource, external_id: id, payload: { ...item, id } } });
    }));
    const values = data.map((row) => row.payload);
    return Array.isArray(body.data) ? values : values[0];
  }
  if (body.action === "update") {
    const data = await Promise.all(matching.map((row) => prisma.resourceRecord.update({ where: { id: row.id }, data: { payload: { ...(row.payload as object), ...(body.data as object) } } })));
    const values = data.map((row) => row.payload);
    return body.single || body.maybeSingle ? values[0] ?? null : values;
  }
  if (body.action === "delete") {
    await prisma.resourceRecord.deleteMany({ where: { id: { in: matching.map((row) => row.id) } } });
    const values = matching.map((row) => row.payload);
    return body.single || body.maybeSingle ? values[0] ?? null : values;
  }
  if (body.action === "upsert") {
    const conflict = body.onConflict || "id";
    const values = await Promise.all(rows.filter(Boolean).map(async (item: any) => {
      const found = existing.find((row) => (row.payload as any)[conflict] === item[conflict]);
      const row = found
        ? await prisma.resourceRecord.update({ where: { id: found.id }, data: { payload: { ...(found.payload as object), ...item } } })
        : await (() => {
          const id = item.id || randomUUID();
          return prisma.resourceRecord.create({ data: { resource, external_id: id, payload: { ...item, id } } });
        })();
      return row.payload;
    }));
    return Array.isArray(body.data) ? values : values[0];
  }
  let values = matching.map((row) => row.payload as Record<string, unknown>);
  for (const entry of [...(body.order ?? [])].reverse()) values.sort((a, b) => String(a[entry.column] ?? "").localeCompare(String(b[entry.column] ?? "")) * (entry.ascending === false ? -1 : 1));
  values = values.slice(body.offset ?? 0, body.limit ? (body.offset ?? 0) + body.limit : undefined);
  return { data: body.head ? [] : body.single || body.maybeSingle ? values[0] ?? null : values, count: body.count === "exact" ? matching.length : null };
}

export const dataRouter = Router();
dataRouter.use(optionalAuth);
dataRouter.post("/:resource/query", asyncRoute(async (request, response) => {
  const resource = String(request.params.resource);
  ensureResource(resource);
  if (!request.user) throw new HttpError(401, "Authentication required");
  const parsed = querySchema.parse(request.body) as QueryBody;
  const { body, admin } = secureQuery(resource, parsed, request.user);
  let result = delegates.has(resource) ? await firstClass(resource, body) : await flexible(resource, body);
  if (!admin && resource === "universities") result = redactUniversity(result);
  if (body.action !== "select") await prisma.auditLog.create({ data: { actor_id: request.user.id, action: `data.${body.action}`, resource, ip_address: request.ip, after: { filter_count: body.filters?.length ?? 0 } } }).catch((error) => logger.error({ err: error, resource, action: body.action }, "Data mutation audit could not be persisted"));
  const wrapped = result && typeof result === "object" && "data" in result ? result : { data: result, count: null };
  response.json(wrapped);
}));
