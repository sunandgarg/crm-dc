import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { Router } from "express";
import { prisma } from "../db.js";
import { asyncRoute, HttpError } from "../http.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { buildPartnerRequest, processLead, processLeadBatch, type ApiConfig, type LeadTask } from "../services/leadPush.js";
import { sendEmail } from "../services/otp.js";

async function runQueueBatch(batchId: string) {
  const pending = await prisma.leads.findMany({ where: { batch_id: batchId, status: "pending" }, orderBy: { created_at: "asc" }, take: 100 });
  const university = pending[0] ? await prisma.universities.findUnique({ where: { id: pending[0].university_id } }) : null;
  if (!university) return { processed: 0, results: [] };
  const tasks = pending.map((lead) => ({
    universityId: lead.university_id,
    batchId,
    leadData: { name: lead.name, email: lead.email, mobile: lead.mobile, state: lead.state || "", city: lead.city || "", course: lead.course || "", specialization: lead.specialization || "", ...((lead.extra_data as Record<string, string>) || {}) },
  }));
  const results = await processLeadBatch(tasks, university.default_push_concurrency || 1);
  await Promise.all(pending.map((lead, index) => prisma.leads.update({ where: { id: lead.id }, data: { status: results[index].status, api_response: results[index].response, processed_at: new Date() } })));
  const remaining = await prisma.leads.count({ where: { batch_id: batchId, status: "pending" } });
  if (!remaining) await prisma.upload_batches.update({ where: { id: batchId }, data: { status: "completed", completed_at: new Date() } });
  return { processed: results.length, results };
}

export const functionsRouter = Router();
functionsRouter.use(requireAuth);

functionsRouter.post("/process-lead", asyncRoute(async (request, response) => {
  const body = request.body as LeadTask & { tasks?: LeadTask[]; concurrency?: number };
  if (Array.isArray(body.tasks)) return response.json({ results: await processLeadBatch(body.tasks, body.concurrency) });
  response.json(await processLead(body));
}));

functionsRouter.post("/process-queue", asyncRoute(async (request, response) => {
  const batchId = String(request.body?.batchId || "");
  if (!batchId) throw new HttpError(400, "batchId is required");
  response.json(await runQueueBatch(batchId));
}));

functionsRouter.post("/test-api", asyncRoute(async (request, response) => {
  const config = request.body as ApiConfig;
  if (!/^https?:\/\//i.test(config.apiUrl || "")) return response.json({ isConfigValid: false, errorMessage: "A valid API URL is required" });
  const built = buildPartnerRequest({ name: "Test Lead", email: "test@example.com", mobile: "9999999999" }, config);
  response.json({ isConfigValid: true, errorMessage: "Configuration and payload mapping are valid", payloadPreview: built.body, headers: Object.keys(built.headers) });
}));

functionsRouter.post("/test-custom-integration", asyncRoute(async (request, response) => {
  const { url, method = "POST", headers = {}, body = {} } = request.body ?? {};
  if (!/^https?:\/\//i.test(url || "")) throw new HttpError(400, "A valid URL is required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const upstream = await fetch(url, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(body), signal: controller.signal });
    response.json({ success: upstream.ok, status: upstream.status, response: await upstream.text() });
  } finally { clearTimeout(timer); }
}));

functionsRouter.post("/purge-university-cache", asyncRoute(async (request, response) => {
  const universityId = String(request.body?.universityId || request.body?.university_id || "");
  if (!universityId) throw new HttpError(400, "universityId is required");
  const result = await prisma.$transaction([
    prisma.api_logs.deleteMany({ where: { university_id: universityId } }),
    prisma.leads.deleteMany({ where: { university_id: universityId } }),
    prisma.upload_batches.deleteMany({ where: { university_id: universityId } }),
  ]);
  response.json({ success: true, deleted: result.reduce((sum, item) => sum + item.count, 0) });
}));

functionsRouter.post("/server-ip", asyncRoute(async (request, response) => {
  response.json({ ip: request.ip, note: "For stable partner allowlisting, assign a fixed egress IP to the API deployment." });
}));

functionsRouter.post("/verify-domain", asyncRoute(async (request, response) => {
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
    return response.json({ users: users.map((user) => ({ ...user, roles: [user.role, ...roles.filter((item) => item.user_id === user.id).map((item) => item.role)], permissions: permissionRows.filter((item) => item.user_id === user.id).map((item) => item.permission) })) });
  }
  if (action === "create_user") {
    const normalizedEmail = String(email || "").toLowerCase();
    if (!normalizedEmail) throw new HttpError(400, "email is required");
    const existing = await prisma.appUser.findUnique({ where: { email: normalizedEmail } });
    const user = await prisma.appUser.upsert({ where: { email: normalizedEmail }, create: { email: normalizedEmail, full_name: fullName, role: role || "counsellor" }, update: { full_name: fullName, role: role || existing?.role, is_active: true, is_approved: true } });
    return response.json({ user, created: !existing, authentication: "email_otp" });
  }
  if (!userId) throw new HttpError(400, "user_id is required");
  if (action === "approve_user") return response.json({ user: await prisma.appUser.update({ where: { id: userId }, data: { is_approved: true, is_active: true } }) });
  if (action === "revoke_user") return response.json({ user: await prisma.appUser.update({ where: { id: userId }, data: { is_approved: false } }) });
  if (action === "update_role") return response.json({ user: await prisma.appUser.update({ where: { id: userId }, data: { role: newRole || role } }) });
  if (action === "update_permissions") {
    await prisma.user_permissions.deleteMany({ where: { user_id: userId } });
    await prisma.user_permissions.createMany({ data: (permissions as string[]).map((permission) => ({ user_id: userId, permission, granted_by: request.user!.id })) });
    return response.json({ success: true });
  }
  if (action === "force_logout") return response.json({ success: true, note: "Existing JWTs expire within the configured token lifetime" });
  if (action === "change_password") return response.json({ success: true, note: "Passwords are not stored; this deployment uses AWS SES email OTP" });
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

functionsRouter.post("/process-scheduled-batches", asyncRoute(async (_request, response) => {
  const batches = await prisma.upload_batches.findMany({ where: { status: "scheduled", scheduled_at: { lte: new Date() }, is_cancelled: false }, orderBy: { scheduled_at: "asc" }, take: 20 });
  const results = [];
  for (const batch of batches) {
    await prisma.upload_batches.update({ where: { id: batch.id }, data: { status: "processing" } });
    results.push({ batchId: batch.id, ...(await runQueueBatch(batch.id)) });
  }
  response.json({ batches: results });
}));

functionsRouter.post("/sync-leads-to-crm", asyncRoute(async (request, response) => {
  const universityId = request.body?.universityId ? String(request.body.universityId) : undefined;
  const leads = await prisma.leads.findMany({ where: { ...(universityId ? { university_id: universityId } : {}), contacts: { none: {} } }, take: 1000 });
  await prisma.crm_contacts.createMany({ data: leads.map((lead) => ({ lead_id: lead.id, university_id: lead.university_id, name: lead.name, email: lead.email, mobile: lead.mobile, state: lead.state, city: lead.city, course: lead.course, specialization: lead.specialization, source: lead.lead_source, custom_fields: (lead.extra_data as any) || {} })) });
  response.json({ success: true, synced: leads.length });
}));

functionsRouter.post("/smtp-send", asyncRoute(async (request, response) => {
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

functionsRouter.post("/ai-gateway", asyncRoute(async (_request, response) => {
  response.status(501).json({ error: "AI gateway requires an explicitly selected model provider and API credential" });
}));

functionsRouter.post("/:name", asyncRoute(async (request, response) => {
  const id = randomBytes(4).toString("hex");
  response.status(501).json({ error: `Function ${request.params.name} is recorded but not yet migrated`, reference: id });
}));
