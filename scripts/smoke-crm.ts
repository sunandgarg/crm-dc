import 'dotenv/config';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const apiUrl = String(process.env.CRM_SMOKE_API_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
const adminEmail = String(process.env.CRM_SMOKE_ADMIN_EMAIL || process.env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
const adminPassword = String(process.env.CRM_SMOKE_ADMIN_PASSWORD || '');

if (!adminEmail || !adminPassword) throw new Error('CRM_SMOKE_ADMIN_EMAIL and CRM_SMOKE_ADMIN_PASSWORD are required');

interface RequestOptions {
  method?: string;
  token?: string;
  body?: unknown;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const payload = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(response.status, String(payload?.error || `HTTP ${response.status}`));
  return payload as T;
}

async function expectStatus(status: number, action: () => Promise<unknown>) {
  try {
    await action();
  } catch (error) {
    if (error instanceof ApiError && error.status === status) return;
    throw error;
  }
  throw new Error(`Expected HTTP ${status}`);
}

const prisma = new PrismaClient();
const startedAt = new Date();
const stamp = Date.now().toString();
const smokeEmail = `crm-smoke-${stamp}@example.com`;
const smokePassword = `Smoke!${stamp}Aa`;
const bulkReason = `Smoke test bulk reassignment ${stamp}`;
const checks: string[] = [];
const auditResourceIds = new Set<string>();
let adminToken = '';
let smokeUserToken = '';
let smokeUserId = '';
let smokeTeamId = '';
let smokeStageId = '';
let savedViewId = '';
const contactIds: string[] = [];

try {
  const adminSession = await request<{ token: string; user: { id: string; role: string } }>('/api/auth/sign-in-password', { method: 'POST', body: { email: adminEmail, password: adminPassword } });
  adminToken = adminSession.token;
  assert.equal(adminSession.user.role, 'super_admin');
  checks.push('super-admin login');

  const meta = await request<{ actor: { id: string }; stages: Array<{ id: string; is_default?: boolean }>; teams: Array<{ id: string }> }>('/api/crm/meta', { token: adminToken });
  const defaultStage = meta.stages.find((stage) => stage.is_default) || meta.stages[0];
  assert.ok(defaultStage);
  checks.push('CRM metadata');

  const teamResult = await request<{ team: { id: string } }>('/api/crm/teams', { method: 'POST', token: adminToken, body: { name: `Smoke Admissions ${stamp}`, description: 'Temporary end-to-end verification team' } });
  smokeTeamId = teamResult.team.id;
  auditResourceIds.add(smokeTeamId);
  checks.push('team creation');

  const stageResult = await request<{ stage: { id: string } }>('/api/crm/stages', { method: 'POST', token: adminToken, body: { name: `Smoke Stage ${stamp}`, color: '#0f766e', isDefault: false } });
  smokeStageId = stageResult.stage.id;
  auditResourceIds.add(smokeStageId);
  await request(`/api/crm/stages/${smokeStageId}`, { method: 'PATCH', token: adminToken, body: { name: `Smoke Qualified ${stamp}`, color: '#0891b2' } });
  checks.push('stage creation and update');

  const userResult = await request<{ user: { id: string } }>('/api/crm/users', {
    method: 'POST', token: adminToken, body: {
      email: smokeEmail,
      fullName: 'CRM Smoke Counsellor',
      role: 'team_lead',
      teamId: smokeTeamId,
      password: smokePassword,
      permissions: ['view_leads', 'add_leads', 'update_leads', 'assign_leads', 'manage_tasks', 'view_reports'],
    },
  });
  smokeUserId = userResult.user.id;
  auditResourceIds.add(smokeUserId);
  await request(`/api/crm/teams/${smokeTeamId}`, { method: 'PATCH', token: adminToken, body: { managerId: smokeUserId } });
  checks.push('user creation, role, team, and permissions');

  const userSession = await request<{ token: string; user: { id: string; role: string } }>('/api/auth/sign-in-password', { method: 'POST', body: { email: smokeEmail, password: smokePassword } });
  smokeUserToken = userSession.token;
  assert.equal(userSession.user.id, smokeUserId);
  assert.equal(userSession.user.role, 'team_lead');
  checks.push('created-user login');

  await expectStatus(403, () => request('/api/crm/users', { token: smokeUserToken }));
  checks.push('role access restriction');

  const firstLeadName = `Smoke Lead A ${stamp}`;
  const firstLead = await request<{ contact: { id: string; owner_id: string; stage_id: string } }>('/api/crm/contacts', { method: 'POST', token: smokeUserToken, body: { name: firstLeadName, email: `smoke-a-${stamp}@example.com`, mobile: `91${stamp.slice(-10)}`, course: 'MBA', source: 'Smoke Test', stageId: smokeStageId, priority: 'High' } });
  contactIds.push(firstLead.contact.id);
  auditResourceIds.add(firstLead.contact.id);
  assert.equal(firstLead.contact.owner_id, smokeUserId);
  assert.equal(firstLead.contact.stage_id, smokeStageId);
  checks.push('lead creation and automatic ownership');

  await expectStatus(409, () => request('/api/crm/contacts', { method: 'POST', token: smokeUserToken, body: { name: firstLeadName, email: `smoke-a-${stamp}@example.com`, mobile: `91${stamp.slice(-10)}` } }));
  checks.push('duplicate lead protection');

  const followUpAt = new Date(Date.now() + 3_600_000).toISOString();
  await request(`/api/crm/contacts/${firstLead.contact.id}/activities`, { method: 'POST', token: smokeUserToken, body: { type: 'call', title: 'Qualification call', description: 'End-to-end CRM workflow validation', outcome: 'Interested', nextFollowUp: followUpAt, createTask: true } });
  const taskList = await request<{ tasks: Array<{ id: string; contact_id?: string | null }> }>('/api/crm/tasks?status=pending', { token: smokeUserToken });
  const followUpTask = taskList.tasks.find((task) => task.contact_id === firstLead.contact.id);
  assert.ok(followUpTask);
  await request(`/api/crm/tasks/${followUpTask.id}`, { method: 'PATCH', token: smokeUserToken, body: { status: 'completed' } });
  checks.push('activity, follow-up, task creation, and completion');

  const savedView = await request<{ view: { id: string } }>('/api/crm/saved-views', { method: 'POST', token: smokeUserToken, body: { name: `Smoke View ${stamp}`, filters: { source: 'Smoke Test' }, columns: ['name', 'stage', 'owner'], isDefault: false } });
  savedViewId = savedView.view.id;
  checks.push('saved lead view');

  const secondLead = await request<{ contact: { id: string } }>('/api/crm/contacts', { method: 'POST', token: adminToken, body: { name: `Smoke Lead B ${stamp}`, email: `smoke-b-${stamp}@example.com`, mobile: `92${stamp.slice(-10)}`, course: 'BBA', source: 'Smoke Test', stageId: smokeStageId, ownerId: smokeUserId, priority: 'Medium' } });
  contactIds.push(secondLead.contact.id);
  auditResourceIds.add(secondLead.contact.id);
  const teamLeadList = await request<{ contacts: Array<{ id: string }> }>(`/api/crm/contacts?pageSize=50&ownerId=${smokeUserId}`, { token: smokeUserToken });
  assert.ok(contactIds.every((id) => teamLeadList.contacts.some((contact) => contact.id === id)));
  await request('/api/crm/contacts/bulk', { method: 'POST', token: adminToken, body: { ids: contactIds, stageId: defaultStage.id, ownerId: meta.actor.id, reason: bulkReason } });
  const scopedList = await request<{ contacts: Array<{ id: string }> }>('/api/crm/contacts?pageSize=50', { token: smokeUserToken });
  assert.ok(contactIds.every((id) => !scopedList.contacts.some((contact) => contact.id === id)));
  checks.push('bulk stage update, reassignment remark, and ownership scope');

  const report = await request<{ stats: { total: number; assigned: number } }>('/api/crm/reports', { token: adminToken });
  assert.ok(report.stats.total >= 2);
  assert.ok(report.stats.assigned >= 2);
  checks.push('aggregated reports');

  const audit = await request<{ logs: Array<{ resource_id?: string | null }>; total: number }>(`/api/crm/audit?search=${firstLead.contact.id}`, { token: adminToken });
  assert.ok(audit.total > 0);
  assert.ok(audit.logs.some((entry) => entry.resource_id === firstLead.contact.id));
  checks.push('searchable audit history');

  await request(`/api/crm/saved-views/${savedViewId}`, { method: 'DELETE', token: smokeUserToken });
  savedViewId = '';
  for (const id of contactIds) await request(`/api/crm/contacts/${id}`, { method: 'DELETE', token: adminToken });
  contactIds.length = 0;
  await request(`/api/crm/stages/${smokeStageId}`, { method: 'DELETE', token: adminToken });
  smokeStageId = '';
  await request(`/api/crm/users/${smokeUserId}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
  await request(`/api/crm/teams/${smokeTeamId}`, { method: 'PATCH', token: adminToken, body: { isActive: false } });
  checks.push('lead deletion and user/team deactivation');

  console.log(`CRM smoke test passed (${checks.length} checks)`);
  checks.forEach((check) => console.log(`PASS ${check}`));
} finally {
  if (adminToken) {
    if (savedViewId) await request(`/api/crm/saved-views/${savedViewId}`, { method: 'DELETE', token: smokeUserToken || adminToken }).catch(() => undefined);
    for (const id of contactIds) await request(`/api/crm/contacts/${id}`, { method: 'DELETE', token: adminToken }).catch(() => undefined);
    if (smokeStageId) await request(`/api/crm/stages/${smokeStageId}`, { method: 'DELETE', token: adminToken }).catch(() => undefined);
  }
  await prisma.auditLog.deleteMany({
    where: {
      created_at: { gte: startedAt },
      OR: [
        { resource_id: { in: [...auditResourceIds] } },
        ...(smokeUserId ? [{ actor_id: smokeUserId }] : []),
        { action: 'crm.lead.bulk_update', after: { path: ['reason'], equals: bulkReason } },
      ],
    },
  }).catch(() => undefined);
  if (smokeUserId) {
    await prisma.user_permissions.deleteMany({ where: { user_id: smokeUserId } }).catch(() => undefined);
    await prisma.crm_saved_views.deleteMany({ where: { user_id: smokeUserId } }).catch(() => undefined);
    await prisma.profiles.deleteMany({ where: { id: smokeUserId } }).catch(() => undefined);
    await prisma.appUser.deleteMany({ where: { id: smokeUserId } }).catch(() => undefined);
  }
  if (smokeTeamId) await prisma.crm_teams.deleteMany({ where: { id: smokeTeamId } }).catch(() => undefined);
  await prisma.$disconnect();
}
