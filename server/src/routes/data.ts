import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { optionalAuth } from "../middleware/auth.js";

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
  const existing = await prisma.resourceRecord.findMany({ where: { resource }, orderBy: { created_at: "desc" } });
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
  if (!request.user && resource !== "url_mappings") throw new HttpError(401, "Authentication required");
  const body = request.body as QueryBody;
  const result = delegates.has(resource) ? await firstClass(resource, body) : await flexible(resource, body);
  const wrapped = result && typeof result === "object" && "data" in result ? result : { data: result, count: null };
  response.json(wrapped);
}));
