import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { assertSafeOutboundUrl } from "./outboundUrl.js";
import { logger } from "../logger.js";

export interface ApiConfig {
  apiUrl: string;
  secretKey?: string;
  collegeId?: string;
  source?: string;
  medium?: string;
  campaign?: string;
  apiType?: string;
  columnMapping?: Record<string, unknown>;
  customColumnMapping?: Record<string, unknown>;
  payloadWrapper?: string;
  authType?: string;
  authHeaderKey?: string;
  authHeaderValue?: string;
  customHeaders?: Record<string, unknown>;
  universityDefaults?: Record<string, unknown>;
  apiTimeoutSeconds?: number;
}

export interface LeadTask {
  universityId: string;
  batchId?: string;
  sourceLabel?: string;
  leadData: Record<string, string>;
  apiConfig?: Partial<ApiConfig>;
}

export interface LeadPushResult {
  success: boolean;
  status: string;
  response: string;
  httpStatus: number;
}

type FieldConfig = {
  fieldName: string;
  displayName?: string;
  sourceType?: "lead_data" | "static" | "dynamic";
  sourceKey?: string;
  staticValue?: string;
  dynamicType?: "source" | "medium" | "campaign" | "college_id" | "secret_key";
  isRequired?: boolean;
  sortOrder?: number;
};

function stringRecord(value: unknown): Record<string, string> {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return {}; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(Object.entries(parsed).map(([key, item]) => [key, typeof item === "string" ? item : JSON.stringify(item ?? "")]));
}

function fieldConfig(value: unknown): FieldConfig | null {
  let parsed = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { return null; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const config = parsed as Partial<FieldConfig>;
  return config.fieldName ? { ...config, fieldName: String(config.fieldName) } : null;
}

function first(payload: Record<string, string>, keys: string[]) {
  return keys.map((key) => payload[key]).find((value) => String(value ?? "").trim()) ?? "";
}

function normalizeMeritto(payload: Record<string, string>, config: ApiConfig) {
  payload.college_id = config.collegeId ?? payload.college_id ?? "";
  payload.secret_key = config.secretKey ?? payload.secret_key ?? "";
  const course = first(payload, ["course", "Course"]);
  const specialization = first(payload, ["specialization", "Specialization", "Specialisation", "specialisation"]);
  if (course) payload.course = course;
  if (specialization) payload.specialization = specialization;
  delete payload.Course;
  delete payload.Specialization;
  delete payload.Specialisation;
  delete payload.specialisation;
}

function leadSquaredPayload(payload: Record<string, string>, config: ApiConfig) {
  const source = payload.leadSource || payload.source || config.source;
  const medium = payload.leadMedium || payload.medium || config.medium;
  const campaign = payload.leadCampaign || payload.campaign || config.campaign;
  delete payload.source;
  delete payload.medium;
  delete payload.campaign;
  if (source) payload.leadSource = source;
  if (medium) payload.leadMedium = medium;
  if (campaign) payload.leadCampaign = campaign;
  const order = ["FirstName", "EmailAddress", "Phone", "mx_State", "mx_City", "mx_Course", "leadSource", "leadMedium", "leadCampaign"];
  return Object.entries(payload)
    .filter(([, value]) => String(value ?? "").trim())
    .sort(([left], [right]) => {
      const l = order.indexOf(left);
      const r = order.indexOf(right);
      return (l < 0 ? order.length : l) - (r < 0 ? order.length : r);
    })
    .map(([Attribute, Value]) => ({ Attribute, Value: String(Value) }));
}

export function buildPartnerRequest(leadData: Record<string, string>, config: ApiConfig) {
  const mapping = stringRecord(config.columnMapping);
  const customMapping = stringRecord(config.customColumnMapping);
  const defaults = stringRecord(config.universityDefaults);
  const customHeaders = stringRecord(config.customHeaders);
  const headers: Record<string, string> = { "Content-Type": "application/json", ...customHeaders };

  if (config.authType === "bearer" && config.authHeaderValue) headers.Authorization = `Bearer ${config.authHeaderValue}`;
  if (config.authType === "custom_header" && config.authHeaderKey && config.authHeaderValue) headers[config.authHeaderKey] = config.authHeaderValue;

  const data = { ...defaults, ...leadData };
  const fields: FieldConfig[] = [];
  const staticFields: Record<string, string> = {};
  const directMapping: Record<string, string> = { ...customMapping };
  Object.entries(mapping).forEach(([key, value]) => {
    if (key.startsWith("__field_")) {
      const parsed = fieldConfig(value);
      if (parsed) fields.push(parsed);
    } else if (key.startsWith("__static_")) staticFields[key.slice(9)] = value;
    else if (key.startsWith("__fixed_") && !data[key.slice(8)]) data[key.slice(8)] = value;
    else directMapping[key] = value;
  });

  const payload: Record<string, string> = {};
  if (fields.length) {
    fields.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)).forEach((field) => {
      let value = "";
      if (field.sourceType === "static") value = field.staticValue ?? "";
      else if (field.sourceType === "dynamic") value = String({
        source: data.leadSource || config.source,
        medium: data.leadMedium || config.medium,
        campaign: data.leadCampaign || config.campaign,
        college_id: config.collegeId,
        secret_key: config.secretKey,
      }[field.dynamicType ?? "source"] ?? "");
      else value = first(data, [field.sourceKey ?? field.fieldName, field.fieldName, field.displayName ?? ""]);
      if (value || field.isRequired) payload[field.fieldName] = value;
    });
  } else {
    Object.entries(data).forEach(([key, value]) => {
      if (String(value ?? "").trim()) payload[directMapping[key] || key] = String(value);
    });
  }
  Object.entries(staticFields).forEach(([key, value]) => { if (value) payload[key] = value; });

  const type = String(config.apiType ?? "generic").toLowerCase();
  if (["meritto", "nopaperforms"].includes(type)) {
    payload[directMapping.source || "source"] ||= data.leadSource || config.source || "";
    payload[directMapping.medium || "medium"] ||= data.leadMedium || config.medium || "";
    payload[directMapping.campaign || "campaign"] ||= data.leadCampaign || config.campaign || "";
    normalizeMeritto(payload, config);
  }

  let body: unknown = type === "leadsquared" ? leadSquaredPayload(payload, config) : payload;
  if (config.payloadWrapper === "array" && !Array.isArray(body)) body = [body];
  return { headers, body };
}

export function categorizePartnerResponse(httpStatus: number, responseBody: string, ok: boolean) {
  const text = responseBody.toLowerCase();
  if (httpStatus === 409 || ["duplicate", "already exist", "already registered", "already present", "lead already", "email already", "mobile already"].some((term) => text.includes(term))) return "Duplicate";
  if (!ok) return "Fail";
  try {
    const value = JSON.parse(responseBody) as Record<string, unknown>;
    const message = value.Message;
    const isCreated = message && typeof message === "object" ? (message as Record<string, unknown>).IsCreated : value.IsCreated;
    if (isCreated === false || value.isLeadExists === true || value.leadAlreadyExists === true || value.firstByUser === false) return "Duplicate";
    if (isCreated === true || value.success === true || value.status === true || value.status === 1 || value.result === true || value.leadIdentifier || value.leadId) return "Success";
    const status = String(value.status ?? value.Status ?? "").toLowerCase();
    if (status === "success" || status === "200" || String(value.message ?? "").toLowerCase().includes("success")) return "Success";
    return "Fail";
  } catch {
    return ["1", "true", "success", "ok"].includes(responseBody.trim().toLowerCase().replace(/^["']|["']$/g, "")) ? "Success" : "Fail";
  }
}

async function hydrateConfig(task: LeadTask): Promise<ApiConfig> {
  const university = await prisma.universities.findUnique({ where: { id: task.universityId } });
  if (!university && !task.apiConfig?.apiUrl) throw new Error("University API configuration was not found");
  const supplied = task.apiConfig ?? {};
  return {
    apiUrl: supplied.apiUrl || university?.api_url || "",
    secretKey: supplied.secretKey || university?.secret_key,
    collegeId: supplied.collegeId || university?.college_id,
    source: supplied.source || university?.source || "",
    medium: supplied.medium || university?.medium || "",
    campaign: supplied.campaign || university?.campaign || "",
    apiType: supplied.apiType || university?.api_type || "generic",
    columnMapping: supplied.columnMapping || (university?.column_mapping as Record<string, unknown>) || {},
    customColumnMapping: supplied.customColumnMapping || {},
    payloadWrapper: supplied.payloadWrapper || university?.payload_wrapper || "object",
    authType: supplied.authType || university?.auth_type || "secret_key",
    authHeaderKey: supplied.authHeaderKey || university?.auth_header_key || "",
    authHeaderValue: supplied.authHeaderValue || university?.auth_header_value || "",
    customHeaders: supplied.customHeaders || (university?.custom_headers as Record<string, unknown>) || {},
    universityDefaults: supplied.universityDefaults || (university?.default_values as Record<string, unknown>) || {},
    apiTimeoutSeconds: supplied.apiTimeoutSeconds || university?.api_timeout_seconds || 30,
  };
}

async function recordResult(task: LeadTask, result: LeadPushResult) {
  const batchUpdate = result.status === "Success" ? { success_count: { increment: 1 } } : result.status === "Duplicate" ? { duplicate_count: { increment: 1 } } : { fail_count: { increment: 1 } };
  if (task.batchId && !["Cancelled", "DLL_Blocked", "Disabled"].includes(result.status)) {
    await prisma.upload_batches.update({ where: { id: task.batchId }, data: { ...batchUpdate, processed_count: { increment: 1 } } }).catch(() => undefined);
  }
  await prisma.api_logs.create({ data: {
    university_id: task.universityId,
    batch_id: task.batchId || null,
    email: task.leadData.email || task.leadData.Email || null,
    mobile: task.leadData.mobile || task.leadData.Phone || null,
    status: result.status,
    response: result.response,
    lead_data: task.leadData as Prisma.InputJsonValue,
    source: task.sourceLabel || task.leadData.leadSource || null,
    medium: task.leadData.leadMedium || null,
    campaign: task.leadData.leadCampaign || null,
  } });
}

export async function processLead(task: LeadTask): Promise<LeadPushResult> {
  if (!task.universityId || !task.leadData) throw new Error("universityId and leadData are required");
  const university = await prisma.universities.findUnique({ where: { id: task.universityId } });
  if (university?.status.toLowerCase() === "disabled") return { success: false, status: "Disabled", response: "University is disabled - push blocked", httpStatus: 0 };
  if (task.batchId) {
    const batch = await prisma.upload_batches.findUnique({ where: { id: task.batchId } });
    if (!batch || batch.is_paused || batch.is_cancelled || ["paused", "cancelled", "stopped"].includes(String(batch.status).toLowerCase())) return { success: false, status: "Cancelled", response: "Processing was stopped before this lead was sent", httpStatus: 0 };
  }
  const config = await hydrateConfig(task);
  await assertSafeOutboundUrl(config.apiUrl);
  const dailyLimit = university?.daily_lead_limit ?? university?.daily_limit ?? null;
  let reservedDailySlot = false;
  if (university && dailyLimit && dailyLimit > 0) {
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    await prisma.universities.updateMany({ where: { id: university.id, daily_count_reset_at: { lt: startOfDay } }, data: { daily_pushed_count: 0, daily_count_reset_at: new Date() } });
    const reserved = await prisma.universities.updateMany({ where: { id: university.id, daily_pushed_count: { lt: dailyLimit } }, data: { daily_pushed_count: { increment: 1 } } });
    if (!reserved.count) return { success: false, status: "DLL_Blocked", response: `Daily lead limit reached (${dailyLimit})`, httpStatus: 0 };
    reservedDailySlot = true;
  }
  const request = buildPartnerRequest(task.leadData, config);
  const timeoutMs = Math.min(300_000, Math.max(5_000, Number(config.apiTimeoutSeconds ?? 30) * 1000));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let result: LeadPushResult;
  try {
    const response = await fetch(config.apiUrl, { method: "POST", headers: request.headers, body: JSON.stringify(request.body), signal: controller.signal });
    const body = await response.text();
    const status = categorizePartnerResponse(response.status, body, response.ok);
    result = { success: status === "Success", status, response: body, httpStatus: response.status };
  } catch (error) {
    const timeout = error instanceof Error && error.name === "AbortError";
    result = { success: false, status: "Fail", response: timeout ? `Partner API timed out after ${timeoutMs / 1000} seconds` : String(error), httpStatus: 0 };
  } finally { clearTimeout(timer); }

  try {
    if (reservedDailySlot && result.status !== "Success") await prisma.universities.update({ where: { id: task.universityId }, data: { daily_pushed_count: { decrement: 1 } } });
    if (!reservedDailySlot && result.status === "Success") await prisma.universities.update({ where: { id: task.universityId }, data: { daily_pushed_count: { increment: 1 } } });
  } catch (error) { logger.error({ err: error, universityId: task.universityId }, "Daily lead counter could not be updated"); }
  try { await recordResult(task, result); }
  catch (error) { logger.error({ err: error, universityId: task.universityId, batchId: task.batchId }, "Partner result could not be persisted"); }
  return result;
}

export async function processLeadBatch(tasks: LeadTask[], requestedConcurrency = 1) {
  const concurrency = Math.min(5, Math.max(1, Number(requestedConcurrency) || 1));
  const results: LeadPushResult[] = new Array(tasks.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, async () => {
    while (cursor < tasks.length) {
      const index = cursor++;
      try { results[index] = await processLead(tasks[index]); }
      catch (error) { results[index] = { success: false, status: "Fail", response: String(error), httpStatus: 0 }; }
    }
  }));
  return results;
}
