import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { buildPartnerRequest, processLead, processLeadBatch, type ApiConfig, type LeadTask } from "../services/leadPush.js";
import { sendEmail } from "../services/otp.js";
import { runAiGateway } from "../services/ai.js";
import { runQueueBatch, runScheduledBatches } from "../services/batchProcessor.js";
import { integrationReadiness } from "../services/readiness.js";
import { assertSafeOutboundUrl } from "../services/outboundUrl.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { config as serverConfig } from "../config.js";
import { hash } from "bcryptjs";

export const functionsRouter = Router();
functionsRouter.use(requireAuth);

function safeUser<T extends { password_hash?: string | null }>(user: T) {
  const { password_hash: _passwordHash, ...safe } = user;
  return safe;
}

functionsRouter.post("/process-lead", rateLimit("process-lead", 60_000, serverConfig.PROCESS_RATE_LIMIT_PER_MINUTE, (request) => request.header("authorization")?.slice(-24) || request.ip || "unknown"), asyncRoute(async (request, response) => {
  const body = request.body as LeadTask & { tasks?: LeadTask[]; concurrency?: number };
  if (!['admin', 'super_admin'].includes(request.user!.role)) {
    if (body.apiConfig || body.tasks?.some((task) => task.apiConfig)) throw new HttpError(403, "API configuration overrides require administrator access");
    const batchIds = [...new Set([body.batchId, ...(body.tasks ?? []).map((task) => task.batchId)].filter(Boolean))] as string[];
    const owned = await prisma.upload_batches.count({ where: { id: { in: batchIds }, user_id: request.user!.id } });
    if (batchIds.length && owned !== batchIds.length) throw new HttpError(403, "Batch access denied");
  }
  if (Array.isArray(body.tasks)) return response.json({ results: await processLeadBatch(body.tasks, body.concurrency) });
  response.json(await processLead(body));
}));

functionsRouter.post("/process-queue", asyncRoute(async (request, response) => {
  const batchId = String(request.body?.batchId || "");
  if (!batchId) throw new HttpError(400, "batchId is required");
  if (!['admin', 'super_admin'].includes(request.user!.role)) {
    const batch = await prisma.upload_batches.findFirst({ where: { id: batchId, user_id: request.user!.id } });
    if (!batch) throw new HttpError(403, "Batch access denied");
  }
  response.json(await runQueueBatch(batchId));
}));

functionsRouter.post("/test-api", requireAdmin, asyncRoute(async (request, response) => {
  const config = request.body as ApiConfig;
  if (!/^https?:\/\//i.test(config.apiUrl || "")) return response.json({ isConfigValid: false, errorMessage: "A valid API URL is required" });
  const built = buildPartnerRequest({ name: "Test Lead", email: "test@example.com", mobile: "9999999999" }, config);
  response.json({ isConfigValid: true, errorMessage: "Configuration and payload mapping are valid", payloadPreview: built.body, headers: Object.keys(built.headers) });
}));

functionsRouter.post("/test-custom-integration", requireAdmin, asyncRoute(async (request, response) => {
  const { url, method = "POST", headers = {}, body = {} } = request.body ?? {};
  await assertSafeOutboundUrl(String(url || ""));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(url, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body), signal: controller.signal });
    response.json({ success: upstream.ok, status: upstream.status, response: await upstream.text() });
  } finally { clearTimeout(timer); }
}));

functionsRouter.post("/purge-university-cache", requireAdmin, asyncRoute(async (request, response) => {
  const universityId = String(request.body?.universityId || request.body?.university_id || "");
  if (!universityId) throw new HttpError(400, "universityId is required");
  const result = await prisma.$transaction([
    prisma.api_logs.deleteMany({ where: { university_id: universityId } }),
    prisma.leads.deleteMany({ where: { university_id: universityId } }),
    prisma.upload_batches.deleteMany({ where: { university_id: universityId } }),
  ]);
  response.json({ success: true, deleted: result.reduce((sum, item) => sum + item.count, 0) });
}));

functionsRouter.post("/server-ip", requireAdmin, asyncRoute(async (request, response) => {
  response.json({ ip: request.ip, note: "For stable partner allowlisting, assign a fixed egress IP to the API deployment." });
}));

functionsRouter.post("/verify-domain", requireAdmin, asyncRoute(async (request, response) => {
  const domain = String(request.body?.domain || "").replace(/^https?:\/\//, "").split("/")[0];
  if (!domain) throw new HttpError(400, "domain is required");
  try {
    const result = await lookup(domain);
    response.json({ verified: Boolean(result.address), address: result.address });
  } catch { response.json({ verified: false, error: "Domain does not resolve yet" }); }
}));

functionsRouter.post("/admin-user-management", requireAdmin, asyncRoute(async (request, response) => {
  const { action, user_id: userId, email, full_name: fullName, role, new_role: newRole, permissions = [] } = request.body ?? {};
  if (action === "list_users") {
    const users = await prisma.appUser.findMany({ orderBy: { created_at: "desc" } });
    const roles = await prisma.user_roles.findMany();
    const permissionRows = await prisma.user_permissions.findMany();
    return response.json({ users: users.map((user) => ({ ...safeUser(user), roles: [user.role, ...roles.filter((item) => item.user_id === user.id).map((item) => item.role)], permissions: permissionRows.filter((item) => item.user_id === user.id).map((item) => item.permission) })) });
  }
  if (action === "create_user") {
    const normalizedEmail = String(email || "").toLowerCase();
    if (!normalizedEmail) throw new HttpError(400, "email is required");
    const existing = await prisma.appUser.findUnique({ where: { email: normalizedEmail } });
    const user = await prisma.appUser.upsert({ where: { email: normalizedEmail }, create: { email: normalizedEmail, full_name: fullName, role: role || "counsellor" }, update: { full_name: fullName, role: role || existing?.role, is_active: true, is_approved: true } });
    return response.json({ user: safeUser(user), created: !existing, authentication: "password_or_email_otp" });
  }
  if (!userId) throw new HttpError(400, "user_id is required");
  if (action === "approve_user") return response.json({ user: safeUser(await prisma.appUser.update({ where: { id: userId }, data: { is_approved: true, is_active: true } })) });
  if (action === "revoke_user") return response.json({ user: safeUser(await prisma.appUser.update({ where: { id: userId }, data: { is_approved: false, session_version: { increment: 1 } } })) });
  if (action === "update_role") return response.json({ user: safeUser(await prisma.appUser.update({ where: { id: userId }, data: { role: newRole || role, session_version: { increment: 1 } } })) });
  if (action === "update_permissions") {
    await prisma.user_permissions.deleteMany({ where: { user_id: userId } });
    await prisma.user_permissions.createMany({ data: (permissions as string[]).map((permission) => ({ user_id: userId, permission, granted_by: request.user!.id })) });
    return response.json({ success: true });
  }
  if (action === "force_logout") {
    await prisma.appUser.update({ where: { id: userId }, data: { session_version: { increment: 1 } } });
    return response.json({ success: true });
  }
  if (action === "change_password") {
    const password = String(request.body?.password || request.body?.new_password || "");
    if (password.length < 8 || password.length > 128) throw new HttpError(400, "Password must be between 8 and 128 characters");
    await prisma.appUser.update({ where: { id: userId }, data: { password_hash: await hash(password, 12), session_version: { increment: 1 } } });
    return response.json({ success: true });
  }
  throw new HttpError(400, `Unknown admin action: ${action}`);
}));

functionsRouter.post("/db-import-export", requireAdmin, asyncRoute(async (request, response) => {
  const tables: Record<string, unknown[]> = {};
  if (request.body?.action === "export") {
    for (const name of ["profiles", "universities", "upload_batches", "leads", "api_logs", "pipeline_stages", "crm_contacts", "crm_activities", "crm_tasks", "automation_rules", "marketing_campaigns", "url_mappings", "feature_toggles"]) {
      tables[name] = await (prisma as any)[name].findMany();
    }
    const flexible = await prisma.resourceRecord.findMany();
    flexible.forEach((record) => { (tables[record.resource] ||= []).push(record.payload); });
    return response.json({ exported_at: new Date().toISOString(), table_count: Object.keys(tables).length, total_rows: Object.values(tables).reduce((sum, rows) => sum + rows.length, 0), tables });
  }
  if (request.body?.action === "import") {
    const input = request.body?.data?.tables || {};
    const mode = request.body?.mode || "upsert";
    const firstClass = new Set(["profiles", "universities", "upload_batches", "leads", "api_logs", "pipeline_stages", "crm_contacts", "crm_activities", "crm_tasks", "automation_rules", "marketing_campaigns", "url_mappings", "feature_toggles"]);
    const results: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(input)) {
      const rows = Array.isArray(value) ? value as Record<string, any>[] : [];
      try {
        if (firstClass.has(name)) {
          const delegate = (prisma as any)[name];
          if (mode === "replace") await delegate.deleteMany();
          let inserted = 0;
          for (const row of rows) {
            if (mode === "insert") await delegate.create({ data: row });
            else await delegate.upsert({ where: { id: row.id }, create: row, update: row });
            inserted += 1;
          }
          results[name] = { inserted };
        } else {
          if (mode === "replace") await prisma.resourceRecord.deleteMany({ where: { resource: name } });
          for (const row of rows) {
            const id = String(row.id || randomUUID());
            await prisma.resourceRecord.upsert({ where: { resource_external_id: { resource: name, external_id: id } }, create: { resource: name, external_id: id, payload: { ...row, id } }, update: { payload: { ...row, id } } });
          }
          results[name] = { inserted: rows.length };
        }
      } catch (error) { results[name] = { error: error instanceof Error ? error.message : String(error) }; }
    }
    return response.json({ results });
  }
  throw new HttpError(400, "action must be export or import");
}));

functionsRouter.post("/cleanup-old-data", requireAdmin, asyncRoute(async (request, response) => {
  const retentionDays = Math.max(7, Math.min(3650, Number(request.body?.retentionDays || 180)));
  const before = new Date(Date.now() - retentionDays * 86_400_000);
  const [logs, otps, audits] = await prisma.$transaction([
    prisma.api_logs.deleteMany({ where: { created_at: { lt: before } } }),
    prisma.otpCode.deleteMany({ where: { created_at: { lt: before } } }),
    prisma.auditLog.deleteMany({ where: { created_at: { lt: before } } }),
  ]);
  response.json({ success: true, retentionDays, deleted: { api_logs: logs.count, otp_codes: otps.count, audit_logs: audits.count } });
}));

functionsRouter.post("/process-scheduled-batches", requireAdmin, asyncRoute(async (_request, response) => {
  response.json({ batches: await runScheduledBatches() });
}));

functionsRouter.post("/sync-leads-to-crm", requireAdmin, asyncRoute(async (request, response) => {
  const universityId = request.body?.universityId ? String(request.body.universityId) : undefined;
  const leads = await prisma.leads.findMany({ where: { ...(universityId ? { university_id: universityId } : {}), contacts: { none: {} } }, take: 1000 });
  await prisma.crm_contacts.createMany({ data: leads.map((lead) => ({ lead_id: lead.id, university_id: lead.university_id, name: lead.name, email: lead.email, mobile: lead.mobile, state: lead.state, city: lead.city, course: lead.course, specialization: lead.specialization, source: lead.lead_source, custom_fields: (lead.extra_data as any) || {} })) });
  response.json({ success: true, synced: leads.length });
}));

functionsRouter.post("/smtp-send", requireAdmin, asyncRoute(async (request, response) => {
  const to = Array.isArray(request.body?.to) ? request.body.to : [request.body?.to || request.body?.email].filter(Boolean);
  if (!to.length || !request.body?.subject) throw new HttpError(400, "to and subject are required");
  await sendEmail({ to, subject: String(request.body.subject), html: request.body.html, text: request.body.text });
  response.json({ success: true, provider: "aws-ses", recipients: to.length });
}));

functionsRouter.post("/url-redirect", asyncRoute(async (request, response) => {
  const code = String(request.body?.code || request.body?.short_code || "");
  const mapping = await prisma.url_mappings.findUnique({ where: { short_code: code } });
  if (!mapping?.is_active || (mapping.expires_at && mapping.expires_at < new Date())) throw new HttpError(404, "Short link not found");
  await prisma.url_mappings.update({ where: { id: mapping.id }, data: { clicks: { increment: 1 } } });
  response.json({ original_url: mapping.original_url, redirectTo: mapping.original_url });
}));

functionsRouter.post("/ai-gateway", asyncRoute(async (request, response) => {
  response.json(await runAiGateway(request.body));
}));

functionsRouter.post("/integration-readiness", requireAdmin, asyncRoute(async (_request, response) => {
  response.json(integrationReadiness());
}));

functionsRouter.post("/:name", asyncRoute(async (request, response) => {
  const id = randomBytes(4).toString("hex");
  response.status(501).json({ error: `Function ${request.params.name} is recorded but not yet migrated`, reference: id });
}));
