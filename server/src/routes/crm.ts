import { randomBytes } from 'node:crypto';
import { Router } from 'express';
import { hash } from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import type { AuthUser, AuthenticatedRequest } from '../types.js';

const ADMIN_ROLES = new Set(['admin', 'super_admin']);
const MANAGER_ROLES = new Set(['admin', 'super_admin', 'team_lead']);
const USER_ROLES = ['super_admin', 'admin', 'team_lead', 'counsellor'] as const;
const ACTIVITY_TYPES = ['note', 'call', 'email', 'whatsapp', 'meeting', 'follow_up'] as const;
const CRM_PERMISSIONS = [
  'view_leads', 'add_leads', 'update_leads', 'assign_leads', 'delete_leads',
  'import_leads', 'download_leads', 'manage_tasks', 'view_reports',
  'manage_users', 'manage_settings',
] as const;

const uuid = z.string().uuid();
const optionalText = z.string().trim().max(500).optional().nullable();
const contactFields = z.object({
  name: z.string().trim().min(2).max(150),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  mobile: z.string().trim().min(7).max(20),
  alternateMobile: z.string().trim().max(20).optional().nullable(),
  stageId: uuid.optional().nullable(),
  ownerId: uuid.optional().nullable(),
  universityId: uuid.optional().nullable(),
  state: optionalText,
  city: optionalText,
  course: optionalText,
  specialization: optionalText,
  source: optionalText,
  medium: optionalText,
  campaignName: optionalText,
  priority: z.enum(['Low', 'Medium', 'High', 'Urgent']).optional(),
  leadScore: z.number().int().min(0).max(100).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
  nextFollowUp: z.string().datetime().optional().nullable(),
  expectedEnrollmentDate: z.string().date().optional().nullable(),
  statusReason: optionalText,
  notes: z.string().trim().max(5000).optional().nullable(),
});

const updateContactSchema = contactFields.partial().extend({
  favourite: z.boolean().optional(),
  reason: z.string().trim().max(500).optional(),
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
  search: z.string().trim().max(200).optional(),
  stageId: uuid.optional(),
  ownerId: z.string().trim().optional(),
  source: z.string().trim().max(100).optional(),
  priority: z.string().trim().max(20).optional(),
  favourite: z.enum(['true', 'false']).optional(),
  untouched: z.enum(['true', 'false']).optional(),
  followUp: z.enum(['true', 'false']).optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'name', 'lead_score', 'next_follow_up']).default('created_at'),
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
});

function userOrThrow(request: AuthenticatedRequest): AuthUser {
  if (!request.user) throw new HttpError(401, 'Authentication required');
  return request.user;
}

function requireManager(request: AuthenticatedRequest): AuthUser {
  const user = userOrThrow(request);
  if (!MANAGER_ROLES.has(user.role)) throw new HttpError(403, 'Manager access required');
  return user;
}

function requireAdminUser(request: AuthenticatedRequest): AuthUser {
  const user = userOrThrow(request);
  if (!ADMIN_ROLES.has(user.role)) throw new HttpError(403, 'Administrator access required');
  return user;
}

async function assertPermission(user: AuthUser, permission: string) {
  if (ADMIN_ROLES.has(user.role)) return;
  const granted = await prisma.user_permissions.findUnique({
    where: { user_id_permission: { user_id: user.id, permission } },
    select: { id: true },
  });
  if (!granted) throw new HttpError(403, `Permission required: ${permission}`);
}

async function ownershipScope(user: AuthUser) {
  if (ADMIN_ROLES.has(user.role)) return {};
  if (user.role === 'team_lead') {
    const profile = await prisma.appUser.findUnique({ where: { id: user.id }, select: { team_id: true } });
    if (profile?.team_id) return { OR: [{ owner_id: user.id }, { owner: { team_id: profile.team_id } }] };
  }
  return { owner_id: user.id };
}

async function taskScope(user: AuthUser) {
  if (ADMIN_ROLES.has(user.role)) return {};
  const contactScope = await ownershipScope(user);
  if (user.role === 'team_lead') {
    const profile = await prisma.appUser.findUnique({ where: { id: user.id }, select: { team_id: true } });
    return {
      OR: [
        { assignee_id: user.id },
        ...(profile?.team_id ? [{ assignee: { team_id: profile.team_id } }] : []),
        { contact: contactScope },
      ],
    };
  }
  return { OR: [{ assignee_id: user.id }, { contact: contactScope }] };
}

async function accessibleContact(contactId: string, user: AuthUser) {
  const scope = await ownershipScope(user);
  const contact = await prisma.crm_contacts.findFirst({ where: { id: contactId, AND: [scope] } });
  if (!contact) throw new HttpError(404, 'Lead not found');
  return contact;
}

async function validateOwner(ownerId: string | null | undefined, actor: AuthUser) {
  if (!ownerId) return null;
  if (!MANAGER_ROLES.has(actor.role) && ownerId !== actor.id) throw new HttpError(403, 'Cannot assign leads to another user');
  const owner = await prisma.appUser.findFirst({ where: { id: ownerId, is_active: true, is_approved: true } });
  if (!owner) throw new HttpError(400, 'Selected owner is not active');
  if (actor.role === 'team_lead' && owner.id !== actor.id) {
    const lead = await prisma.appUser.findUnique({ where: { id: actor.id }, select: { team_id: true } });
    if (!lead?.team_id || owner.team_id !== lead.team_id) throw new HttpError(403, 'Team leads can assign only within their team');
  }
  return owner;
}

async function validateTeam(teamId: string | null | undefined) {
  if (!teamId) return null;
  const team = await prisma.crm_teams.findFirst({ where: { id: teamId, is_active: true } });
  if (!team) throw new HttpError(400, 'Selected team is not active');
  return team;
}

async function validateTeamManager(managerId: string | null | undefined) {
  if (!managerId) return null;
  const manager = await prisma.appUser.findFirst({ where: { id: managerId, is_active: true, is_approved: true } });
  if (!manager || !MANAGER_ROLES.has(manager.role)) throw new HttpError(400, 'Team manager must be an active manager');
  return manager;
}

function contactData(input: z.infer<typeof updateContactSchema>) {
  const data: Record<string, unknown> = {};
  const map: Record<string, string> = {
    name: 'name', email: 'email', mobile: 'mobile', alternateMobile: 'alternate_mobile', stageId: 'stage_id',
    ownerId: 'owner_id', universityId: 'university_id', state: 'state', city: 'city', course: 'course',
    specialization: 'specialization', source: 'source', medium: 'medium', campaignName: 'campaign_name',
    priority: 'priority', leadScore: 'lead_score', tags: 'tags', statusReason: 'status_reason', notes: 'notes',
    favourite: 'is_favourite',
  };
  for (const [key, column] of Object.entries(map)) if (key in input) data[column] = (input as Record<string, unknown>)[key] === '' ? null : (input as Record<string, unknown>)[key];
  if ('nextFollowUp' in input) data.next_follow_up = input.nextFollowUp ? new Date(input.nextFollowUp) : null;
  if ('expectedEnrollmentDate' in input) data.expected_enrollment_date = input.expectedEnrollmentDate ? new Date(input.expectedEnrollmentDate) : null;
  if ('leadScore' in input) data.lead_score_updated_at = new Date();
  return data;
}

async function writeAudit(actor: AuthUser, action: string, resource: string, resourceId: string | null, before: unknown, after: unknown, request: AuthenticatedRequest) {
  await prisma.auditLog.create({
    data: { actor_id: actor.id, action, resource, resource_id: resourceId, before: before as any, after: after as any, ip_address: request.ip },
  });
}

export const crmRouter = Router();
crmRouter.use(requireAuth);

crmRouter.get('/meta', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  const scope = await ownershipScope(actor);
  const actorProfile = await prisma.appUser.findUnique({ where: { id: actor.id }, select: { team_id: true } });
  const userWhere = ADMIN_ROLES.has(actor.role)
    ? { is_active: true, is_approved: true }
    : actor.role === 'team_lead' && actorProfile?.team_id
      ? { is_active: true, is_approved: true, team_id: actorProfile.team_id }
      : { id: actor.id };
  const [stages, users, teams, sourceRows, views, permissions, total] = await Promise.all([
    prisma.pipeline_stages.findMany({ orderBy: { sort_order: 'asc' } }),
    prisma.appUser.findMany({ where: userWhere, select: { id: true, email: true, full_name: true, role: true, team_id: true }, orderBy: { full_name: 'asc' } }),
    prisma.crm_teams.findMany({ where: { is_active: true }, orderBy: { name: 'asc' } }),
    prisma.crm_contacts.findMany({ where: { AND: [scope], source: { not: null } }, select: { source: true }, distinct: ['source'] }),
    prisma.crm_saved_views.findMany({ where: { user_id: actor.id }, orderBy: [{ is_default: 'desc' }, { name: 'asc' }] }),
    prisma.user_permissions.findMany({ where: { user_id: actor.id }, select: { permission: true } }),
    prisma.crm_contacts.count({ where: { AND: [scope] } }),
  ]);
  response.json({
    actor,
    stages,
    users,
    teams,
    sources: sourceRows.map((row) => row.source).filter(Boolean),
    savedViews: views,
    permissions: permissions.map((item) => item.permission),
    total,
  });
}));

crmRouter.get('/contacts', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const input = listSchema.parse(request.query);
  const scope = await ownershipScope(actor);
  const clauses: any[] = [scope];
  if (input.search) clauses.push({ OR: [
    { name: { contains: input.search, mode: 'insensitive' } },
    { email: { contains: input.search, mode: 'insensitive' } },
    { mobile: { contains: input.search } },
    { course: { contains: input.search, mode: 'insensitive' } },
  ] });
  if (input.stageId) clauses.push({ stage_id: input.stageId });
  if (input.ownerId === 'unassigned') clauses.push({ owner_id: null });
  else if (input.ownerId === 'mine') clauses.push({ owner_id: actor.id });
  else if (input.ownerId) {
    const owner = await validateOwner(uuid.parse(input.ownerId), actor);
    clauses.push({ owner_id: owner?.id });
  }
  if (input.source) clauses.push({ source: input.source });
  if (input.priority) clauses.push({ priority: input.priority });
  if (input.favourite) clauses.push({ is_favourite: input.favourite === 'true' });
  if (input.untouched === 'true') clauses.push({ last_contacted_at: null });
  if (input.followUp === 'true') clauses.push({ next_follow_up: { not: null } });
  const where = { AND: clauses };
  const [contacts, total, grouped] = await Promise.all([
    prisma.crm_contacts.findMany({
      where,
      include: { pipeline_stage: true, owner: { select: { id: true, full_name: true, email: true, role: true } }, university: { select: { id: true, name: true } } },
      orderBy: { [input.sortBy]: input.sortDirection },
      skip: (input.page - 1) * input.pageSize,
      take: input.pageSize,
    }),
    prisma.crm_contacts.count({ where }),
    prisma.crm_contacts.groupBy({ by: ['stage_id'], where: { AND: [scope] }, _count: { _all: true } }),
  ]);
  response.json({ contacts, total, page: input.page, pageSize: input.pageSize, stageCounts: Object.fromEntries(grouped.map((row) => [row.stage_id || 'unassigned', row._count._all])) });
}));

crmRouter.post('/contacts', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'add_leads');
  const input = contactFields.parse(request.body);
  const duplicates = await prisma.crm_contacts.findMany({
    where: { OR: [{ mobile: input.mobile }, ...(input.email ? [{ email: input.email }] : [])] },
    select: { id: true, name: true, email: true, mobile: true }, take: 5,
  });
  if (duplicates.length) throw new HttpError(409, `Possible duplicate lead: ${duplicates[0].name}`);
  const ownerId = ADMIN_ROLES.has(actor.role) ? input.ownerId : input.ownerId || actor.id;
  const owner = await validateOwner(ownerId, actor);
  const defaultStage = input.stageId ? null : await prisma.pipeline_stages.findFirst({ where: { is_default: true }, orderBy: { sort_order: 'asc' } });
  const created = await prisma.crm_contacts.create({
    data: {
      ...contactData(input),
      name: input.name,
      mobile: input.mobile,
      email: input.email || null,
      stage_id: input.stageId || defaultStage?.id || null,
      owner_id: owner?.id || null,
      assigned_to: owner ? owner.full_name || owner.email : null,
    },
    include: { pipeline_stage: true, owner: { select: { id: true, full_name: true, email: true, role: true } } },
  });
  await prisma.$transaction([
    prisma.crm_activities.create({ data: { contact_id: created.id, type: 'lead_created', title: 'Lead created', description: `Created by ${actor.full_name || actor.email}`, created_by: actor.full_name || actor.email, actor_id: actor.id } }),
    ...(owner ? [prisma.crm_assignment_history.create({ data: { contact_id: created.id, to_owner_id: owner.id, changed_by_id: actor.id, reason: 'Assigned during lead creation' } })] : []),
  ]);
  await writeAudit(actor, 'crm.lead.create', 'crm_contacts', created.id, null, created, request);
  response.status(201).json({ contact: created });
}));

crmRouter.post('/contacts/import', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'import_leads');
  const body = z.object({ rows: z.array(contactFields.omit({ ownerId: true, stageId: true }).extend({ ownerId: uuid.optional().nullable(), stageId: uuid.optional().nullable() })).min(1).max(1000) }).parse(request.body);
  const mobiles = body.rows.map((row) => row.mobile);
  const emails = body.rows.map((row) => row.email).filter(Boolean) as string[];
  const existing = await prisma.crm_contacts.findMany({ where: { OR: [{ mobile: { in: mobiles } }, { email: { in: emails } }] }, select: { mobile: true, email: true } });
  const seenMobiles = new Set(existing.map((row) => row.mobile));
  const seenEmails = new Set(existing.map((row) => row.email).filter(Boolean));
  const defaultStage = await prisma.pipeline_stages.findFirst({ where: { is_default: true }, orderBy: { sort_order: 'asc' } });
  const accepted: any[] = [];
  for (const row of body.rows) {
    if (seenMobiles.has(row.mobile) || (row.email && seenEmails.has(row.email))) continue;
    seenMobiles.add(row.mobile);
    if (row.email) seenEmails.add(row.email);
    const ownerId = ADMIN_ROLES.has(actor.role) ? row.ownerId : row.ownerId || actor.id;
    const owner = ownerId ? await validateOwner(ownerId, actor) : null;
    accepted.push({ ...contactData(row), name: row.name, mobile: row.mobile, email: row.email || null, stage_id: row.stageId || defaultStage?.id || null, owner_id: owner?.id || null, assigned_to: owner ? owner.full_name || owner.email : null });
  }
  if (accepted.length) await prisma.crm_contacts.createMany({ data: accepted });
  await writeAudit(actor, 'crm.lead.import', 'crm_contacts', null, null, { received: body.rows.length, inserted: accepted.length }, request);
  response.status(201).json({ inserted: accepted.length, skipped: body.rows.length - accepted.length });
}));

crmRouter.post('/contacts/bulk', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  const input = z.object({ ids: z.array(uuid).min(1).max(500), stageId: uuid.optional().nullable(), ownerId: uuid.optional().nullable(), reason: z.string().trim().max(500).optional() }).refine((value) => value.stageId !== undefined || value.ownerId !== undefined, 'Choose a stage or owner').parse(request.body);
  await assertPermission(actor, input.ownerId !== undefined ? 'assign_leads' : 'update_leads');
  const scope = await ownershipScope(actor);
  const contacts = await prisma.crm_contacts.findMany({ where: { id: { in: input.ids }, AND: [scope] } });
  if (contacts.length !== input.ids.length) throw new HttpError(403, 'One or more selected leads are not accessible');
  const owner = input.ownerId !== undefined ? await validateOwner(input.ownerId, actor) : undefined;
  const stage = input.stageId ? await prisma.pipeline_stages.findUnique({ where: { id: input.stageId } }) : null;
  if (input.stageId && !stage) throw new HttpError(400, 'Selected stage does not exist');
  const data: any = { updated_at: new Date(), last_activity_at: new Date() };
  if (input.stageId !== undefined) data.stage_id = input.stageId;
  if (input.ownerId !== undefined) { data.owner_id = owner?.id || null; data.assigned_to = owner ? owner.full_name || owner.email : null; }
  await prisma.$transaction(async (tx) => {
    await tx.crm_contacts.updateMany({ where: { id: { in: input.ids } }, data });
    if (input.ownerId !== undefined) await tx.crm_assignment_history.createMany({ data: contacts.map((contact) => ({ contact_id: contact.id, from_owner_id: contact.owner_id, to_owner_id: owner?.id || null, changed_by_id: actor.id, reason: input.reason || 'Bulk assignment' })) });
    await tx.crm_activities.createMany({ data: contacts.map((contact) => ({ contact_id: contact.id, type: input.ownerId !== undefined ? 'assignment' : 'stage_change', title: input.ownerId !== undefined ? 'Lead reassigned' : 'Stage updated', description: input.ownerId !== undefined ? `Assigned to ${owner?.full_name || owner?.email || 'Unassigned'}` : `Moved to ${stage?.name || 'Unassigned'}`, created_by: actor.full_name || actor.email, actor_id: actor.id })) });
  });
  await writeAudit(actor, 'crm.lead.bulk_update', 'crm_contacts', null, null, { count: contacts.length, stageId: input.stageId, ownerId: input.ownerId, reason: input.reason }, request);
  response.json({ updated: contacts.length });
}));

crmRouter.get('/contacts/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const id = uuid.parse(request.params.id);
  await accessibleContact(id, actor);
  const contact = await prisma.crm_contacts.findUnique({
    where: { id },
    include: {
      pipeline_stage: true,
      owner: { select: { id: true, full_name: true, email: true, role: true } },
      university: { select: { id: true, name: true } },
      activities: { include: { actor: { select: { id: true, full_name: true, email: true } } }, orderBy: { created_at: 'desc' }, take: 100 },
      tasks: { include: { assignee: { select: { id: true, full_name: true, email: true } } }, orderBy: { created_at: 'desc' }, take: 100 },
      assignment_history: { include: { from_owner: { select: { full_name: true, email: true } }, to_owner: { select: { full_name: true, email: true } }, changed_by: { select: { full_name: true, email: true } } }, orderBy: { created_at: 'desc' }, take: 50 },
    },
  });
  response.json({ contact });
}));

crmRouter.patch('/contacts/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  const id = uuid.parse(request.params.id);
  const existing = await accessibleContact(id, actor);
  const input = updateContactSchema.parse(request.body);
  await assertPermission(actor, input.ownerId !== undefined ? 'assign_leads' : 'update_leads');
  const owner = input.ownerId !== undefined ? await validateOwner(input.ownerId, actor) : undefined;
  if (input.stageId) {
    const stage = await prisma.pipeline_stages.findUnique({ where: { id: input.stageId } });
    if (!stage) throw new HttpError(400, 'Selected stage does not exist');
  }
  const data: any = { ...contactData(input) };
  if (input.ownerId !== undefined) data.assigned_to = owner ? owner.full_name || owner.email : null;
  const updated = await prisma.$transaction(async (tx) => {
    const contact = await tx.crm_contacts.update({ where: { id }, data, include: { pipeline_stage: true, owner: { select: { id: true, full_name: true, email: true, role: true } } } });
    if (input.ownerId !== undefined && existing.owner_id !== (owner?.id || null)) {
      await tx.crm_assignment_history.create({ data: { contact_id: id, from_owner_id: existing.owner_id, to_owner_id: owner?.id || null, changed_by_id: actor.id, reason: input.reason || 'Manual reassignment' } });
      await tx.crm_activities.create({ data: { contact_id: id, type: 'assignment', title: 'Lead reassigned', description: `Assigned to ${owner?.full_name || owner?.email || 'Unassigned'}${input.reason ? `: ${input.reason}` : ''}`, created_by: actor.full_name || actor.email, actor_id: actor.id } });
    }
    if (input.stageId !== undefined && existing.stage_id !== input.stageId) {
      const stage = input.stageId ? await tx.pipeline_stages.findUnique({ where: { id: input.stageId } }) : null;
      await tx.crm_activities.create({ data: { contact_id: id, type: 'stage_change', title: 'Lead stage updated', description: `Moved to ${stage?.name || 'Unassigned'}${input.reason ? `: ${input.reason}` : ''}`, created_by: actor.full_name || actor.email, actor_id: actor.id } });
    }
    return contact;
  });
  await writeAudit(actor, 'crm.lead.update', 'crm_contacts', id, existing, updated, request);
  response.json({ contact: updated });
}));

crmRouter.delete('/contacts/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'delete_leads');
  const id = uuid.parse(request.params.id);
  const existing = await accessibleContact(id, actor);
  await prisma.crm_contacts.delete({ where: { id } });
  await writeAudit(actor, 'crm.lead.delete', 'crm_contacts', id, existing, null, request);
  response.status(204).end();
}));

crmRouter.post('/contacts/:id/activities', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'update_leads');
  const id = uuid.parse(request.params.id);
  await accessibleContact(id, actor);
  const input = z.object({
    type: z.enum(ACTIVITY_TYPES), title: z.string().trim().min(2).max(200), description: z.string().trim().max(5000).optional(),
    outcome: z.string().trim().max(500).optional(), durationMinutes: z.number().int().min(0).max(1440).optional(),
    scheduledAt: z.string().datetime().optional(), nextFollowUp: z.string().datetime().optional(), createTask: z.boolean().default(false),
  }).parse(request.body);
  const now = new Date();
  const activity = await prisma.$transaction(async (tx) => {
    const created = await tx.crm_activities.create({ data: { contact_id: id, type: input.type, title: input.title, description: input.description, outcome: input.outcome, duration_minutes: input.durationMinutes, scheduled_at: input.scheduledAt ? new Date(input.scheduledAt) : null, completed_at: input.scheduledAt ? null : now, created_by: actor.full_name || actor.email, actor_id: actor.id } });
    const contacted = ['call', 'email', 'whatsapp', 'meeting'].includes(input.type);
    await tx.crm_contacts.update({ where: { id }, data: { last_activity_at: now, ...(contacted ? { last_contacted_at: now } : {}), ...(contacted ? { first_contacted_at: (await tx.crm_contacts.findUnique({ where: { id }, select: { first_contacted_at: true } }))?.first_contacted_at || now } : {}), ...(input.type === 'note' ? { notes_count: { increment: 1 } } : {}), ...(input.nextFollowUp ? { next_follow_up: new Date(input.nextFollowUp) } : {}) } });
    if (input.createTask && input.nextFollowUp) await tx.crm_tasks.create({ data: { contact_id: id, title: `Follow up: ${input.title}`, description: input.description, priority: 'medium', assigned_to: actor.full_name || actor.email, assignee_id: actor.id, due_at: new Date(input.nextFollowUp) } });
    return created;
  });
  await writeAudit(actor, 'crm.activity.create', 'crm_activities', activity.id, null, activity, request);
  response.status(201).json({ activity });
}));

crmRouter.get('/activities', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const type = z.string().trim().max(30).optional().parse(request.query.type);
  const scope = await ownershipScope(actor);
  const activities = await prisma.crm_activities.findMany({
    where: { contact: scope, ...(type ? { type } : {}) },
    include: { contact: { select: { id: true, name: true } }, actor: { select: { id: true, full_name: true, email: true } } },
    orderBy: { created_at: 'desc' },
    take: 500,
  });
  response.json({ activities });
}));

crmRouter.get('/tasks', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'manage_tasks');
  const status = z.enum(['pending', 'completed', 'all']).default('pending').parse(request.query.status);
  const scope = await taskScope(actor);
  const tasks = await prisma.crm_tasks.findMany({ where: { AND: [scope, ...(status === 'all' ? [] : [{ status }])] }, include: { contact: { select: { id: true, name: true, mobile: true } }, assignee: { select: { id: true, full_name: true, email: true } } }, orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }], take: 500 });
  response.json({ tasks });
}));

crmRouter.post('/tasks', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'manage_tasks');
  const input = z.object({ contactId: uuid.optional().nullable(), title: z.string().trim().min(2).max(200), description: z.string().trim().max(3000).optional(), priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium'), dueAt: z.string().datetime(), assigneeId: uuid.optional().nullable() }).parse(request.body);
  if (input.contactId) await accessibleContact(input.contactId, actor);
  const assigneeId = MANAGER_ROLES.has(actor.role) ? input.assigneeId || actor.id : actor.id;
  const assignee = await validateOwner(assigneeId, actor);
  const task = await prisma.crm_tasks.create({ data: { contact_id: input.contactId, title: input.title, description: input.description, priority: input.priority, due_at: new Date(input.dueAt), assignee_id: assignee?.id || actor.id, assigned_to: assignee?.full_name || assignee?.email || actor.full_name || actor.email }, include: { contact: { select: { id: true, name: true, mobile: true } }, assignee: { select: { id: true, full_name: true, email: true } } } });
  await writeAudit(actor, 'crm.task.create', 'crm_tasks', task.id, null, task, request);
  response.status(201).json({ task });
}));

crmRouter.patch('/tasks/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'manage_tasks');
  const id = uuid.parse(request.params.id);
  const scope = await taskScope(actor);
  const existing = await prisma.crm_tasks.findFirst({ where: { id, AND: [scope] }, include: { contact: true } });
  if (!existing) throw new HttpError(404, 'Task not found');
  const input = z.object({ title: z.string().trim().min(2).max(200).optional(), description: z.string().trim().max(3000).optional().nullable(), priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(), dueAt: z.string().datetime().optional().nullable(), status: z.enum(['pending', 'completed']).optional(), assigneeId: uuid.optional().nullable() }).parse(request.body);
  const assignee = input.assigneeId !== undefined ? await validateOwner(input.assigneeId, actor) : undefined;
  const task = await prisma.crm_tasks.update({ where: { id }, data: { title: input.title, description: input.description, priority: input.priority, due_at: input.dueAt === undefined ? undefined : input.dueAt ? new Date(input.dueAt) : null, status: input.status, completed_at: input.status === 'completed' ? new Date() : input.status === 'pending' ? null : undefined, assignee_id: input.assigneeId === undefined ? undefined : assignee?.id || null, assigned_to: input.assigneeId === undefined ? undefined : assignee ? assignee.full_name || assignee.email : null }, include: { contact: { select: { id: true, name: true, mobile: true } }, assignee: { select: { id: true, full_name: true, email: true } } } });
  await writeAudit(actor, 'crm.task.update', 'crm_tasks', id, existing, task, request);
  response.json({ task });
}));

crmRouter.delete('/tasks/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'manage_tasks');
  const id = uuid.parse(request.params.id);
  const scope = await taskScope(actor);
  const task = await prisma.crm_tasks.findFirst({ where: { id, AND: [scope] } });
  if (!task) throw new HttpError(404, 'Task not found');
  await prisma.crm_tasks.delete({ where: { id } });
  await writeAudit(actor, 'crm.task.delete', 'crm_tasks', id, task, null, request);
  response.status(204).end();
}));

crmRouter.get('/dashboard', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const scope = await ownershipScope(actor);
  const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
  const startWeek = new Date(startToday); startWeek.setDate(startWeek.getDate() - 6);
  const [total, newToday, untouched, overdue, stages, activities, tasks, recentContacts] = await Promise.all([
    prisma.crm_contacts.count({ where: { AND: [scope] } }),
    prisma.crm_contacts.count({ where: { AND: [scope], created_at: { gte: startToday } } }),
    prisma.crm_contacts.count({ where: { AND: [scope], last_contacted_at: null } }),
    prisma.crm_contacts.count({ where: { AND: [scope], next_follow_up: { lt: new Date() } } }),
    prisma.pipeline_stages.findMany({ orderBy: { sort_order: 'asc' }, include: { _count: { select: { contacts: { where: scope } } } } }),
    prisma.crm_activities.findMany({ where: { contact: scope }, include: { contact: { select: { id: true, name: true } }, actor: { select: { full_name: true, email: true } } }, orderBy: { created_at: 'desc' }, take: 12 }),
    prisma.crm_tasks.findMany({ where: { AND: [await taskScope(actor), { status: 'pending' }] }, orderBy: { due_at: 'asc' }, take: 8, include: { contact: { select: { id: true, name: true } } } }),
    prisma.crm_contacts.findMany({ where: { AND: [scope], created_at: { gte: startWeek } }, select: { created_at: true } }),
  ]);
  const trend = Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(startWeek); date.setDate(startWeek.getDate() + offset);
    const key = date.toISOString().slice(0, 10);
    return { date: key, label: date.toLocaleDateString('en-US', { weekday: 'short' }), leads: recentContacts.filter((contact) => contact.created_at.toISOString().slice(0, 10) === key).length };
  });
  response.json({ stats: { total, newToday, untouched, overdue }, stages: stages.map((stage) => ({ id: stage.id, name: stage.name, color: stage.color, count: stage._count.contacts })), activities, tasks, trend });
}));

crmRouter.get('/reports', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_reports');
  const today = new Date();
  const defaultFrom = new Date(today); defaultFrom.setDate(defaultFrom.getDate() - 29); defaultFrom.setHours(0, 0, 0, 0);
  const input = z.object({
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  }).parse(request.query);
  const from = input.from ? new Date(`${input.from}T00:00:00.000Z`) : defaultFrom;
  const to = input.to ? new Date(`${input.to}T23:59:59.999Z`) : today;
  if (from > to) throw new HttpError(400, 'Report start date must be before the end date');
  if (to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) throw new HttpError(400, 'Report range cannot exceed 366 days');
  const scope = await ownershipScope(actor);
  const reportTaskScope = await taskScope(actor);
  const where = { AND: [scope, { created_at: { gte: from, lte: to } }] };
  const [total, assigned, contacted, enrolled, stageGroups, sourceGroups, ownerGroups, activityGroups, taskGroups] = await Promise.all([
    prisma.crm_contacts.count({ where }),
    prisma.crm_contacts.count({ where: { AND: [scope, { created_at: { gte: from, lte: to } }, { owner_id: { not: null } }] } }),
    prisma.crm_contacts.count({ where: { AND: [scope, { created_at: { gte: from, lte: to } }, { last_contacted_at: { not: null } }] } }),
    prisma.crm_contacts.count({ where: { AND: [scope, { created_at: { gte: from, lte: to } }, { pipeline_stage: { name: { equals: 'Enrolled', mode: 'insensitive' as const } } }] } }),
    prisma.crm_contacts.groupBy({ by: ['stage_id'], where, _count: { _all: true }, orderBy: { _count: { stage_id: 'desc' } } }),
    prisma.crm_contacts.groupBy({ by: ['source'], where, _count: { _all: true }, orderBy: { _count: { source: 'desc' } }, take: 12 }),
    prisma.crm_contacts.groupBy({ by: ['owner_id'], where, _count: { _all: true }, orderBy: { _count: { owner_id: 'desc' } }, take: 20 }),
    prisma.crm_activities.groupBy({ by: ['type'], where: { created_at: { gte: from, lte: to }, contact: scope }, _count: { _all: true }, orderBy: { _count: { type: 'desc' } } }),
    prisma.crm_tasks.groupBy({ by: ['status'], where: { AND: [reportTaskScope, { created_at: { gte: from, lte: to } }] }, _count: { _all: true } }),
  ]);
  const [stages, owners] = await Promise.all([
    prisma.pipeline_stages.findMany({ where: { id: { in: stageGroups.flatMap((row) => row.stage_id ? [row.stage_id] : []) } }, select: { id: true, name: true, color: true } }),
    prisma.appUser.findMany({ where: { id: { in: ownerGroups.flatMap((row) => row.owner_id ? [row.owner_id] : []) } }, select: { id: true, full_name: true, email: true } }),
  ]);
  const stageMap = new Map(stages.map((stage) => [stage.id, stage]));
  const ownerMap = new Map(owners.map((owner) => [owner.id, owner]));
  const taskStats = Object.fromEntries(taskGroups.map((row) => [row.status, row._count._all]));
  response.json({
    range: { from: from.toISOString(), to: to.toISOString() },
    stats: { total, assigned, contacted, enrolled, conversionRate: total ? Number(((enrolled / total) * 100).toFixed(1)) : 0, taskCompletionRate: (taskStats.pending || 0) + (taskStats.completed || 0) ? Number((((taskStats.completed || 0) / ((taskStats.pending || 0) + (taskStats.completed || 0))) * 100).toFixed(1)) : 0 },
    stages: stageGroups.map((row) => ({ id: row.stage_id || 'unassigned', name: row.stage_id ? stageMap.get(row.stage_id)?.name || 'Unknown' : 'No Stage', color: row.stage_id ? stageMap.get(row.stage_id)?.color || '#94a3b8' : '#94a3b8', count: row._count._all })),
    sources: sourceGroups.map((row) => ({ name: row.source || 'Unknown', count: row._count._all })),
    owners: ownerGroups.map((row) => ({ id: row.owner_id || 'unassigned', name: row.owner_id ? ownerMap.get(row.owner_id)?.full_name || ownerMap.get(row.owner_id)?.email || 'Unknown' : 'Unassigned', count: row._count._all })),
    activities: activityGroups.map((row) => ({ type: row.type, count: row._count._all })),
  });
}));

crmRouter.get('/users', asyncRoute(async (request, response) => {
  requireAdminUser(request);
  const users = await prisma.appUser.findMany({ select: { id: true, email: true, full_name: true, role: true, team: true, team_id: true, is_active: true, is_approved: true, last_sign_in_at: true, created_at: true, crm_team: { select: { id: true, name: true } } }, orderBy: [{ is_active: 'desc' }, { full_name: 'asc' }] });
  const permissions = await prisma.user_permissions.findMany();
  const byUser = new Map<string, string[]>();
  permissions.forEach((item) => byUser.set(item.user_id, [...(byUser.get(item.user_id) || []), item.permission]));
  response.json({ users: users.map((user) => ({ ...user, permissions: byUser.get(user.id) || [] })) });
}));

crmRouter.post('/users', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const input = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()), fullName: z.string().trim().min(2).max(150), role: z.enum(USER_ROLES), teamId: uuid.optional().nullable(), password: z.string().min(8).max(128).optional(), permissions: z.array(z.enum(CRM_PERMISSIONS)).max(CRM_PERMISSIONS.length).default([]) }).parse(request.body);
  if (input.role === 'super_admin' && actor.role !== 'super_admin') throw new HttpError(403, 'Only a super admin can create another super admin');
  if (await prisma.appUser.findUnique({ where: { email: input.email } })) throw new HttpError(409, 'A user with this email already exists');
  const team = await validateTeam(input.teamId);
  const temporaryPassword = input.password || `${randomBytes(9).toString('base64url')}A1!`;
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.appUser.create({ data: { email: input.email, full_name: input.fullName, role: input.role, team_id: team?.id || null, team: team?.name || null, password_hash: await hash(temporaryPassword, 12), is_active: true, is_approved: true } });
    await tx.profiles.upsert({ where: { email: created.email }, create: { id: created.id, email: created.email, full_name: created.full_name, role: created.role, is_approved: true, approved_at: new Date(), approved_by: actor.id }, update: { full_name: created.full_name, role: created.role, is_approved: true } });
    if (input.permissions.length) await tx.user_permissions.createMany({ data: input.permissions.map((permission) => ({ user_id: created.id, permission, granted_by: actor.id })), skipDuplicates: true });
    return created;
  });
  await writeAudit(actor, 'crm.user.create', 'app_users', user.id, null, { email: user.email, role: user.role, team_id: user.team_id }, request);
  response.status(201).json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, team_id: user.team_id, is_active: user.is_active }, generatedPassword: input.password ? undefined : temporaryPassword });
}));

crmRouter.patch('/users/:id', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const id = uuid.parse(request.params.id);
  const existing = await prisma.appUser.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'User not found');
  const input = z.object({ fullName: z.string().trim().min(2).max(150).optional(), role: z.enum(USER_ROLES).optional(), teamId: uuid.optional().nullable(), isActive: z.boolean().optional(), password: z.string().min(8).max(128).optional(), permissions: z.array(z.enum(CRM_PERMISSIONS)).max(CRM_PERMISSIONS.length).optional() }).parse(request.body);
  if ((existing.role === 'super_admin' || input.role === 'super_admin') && actor.role !== 'super_admin') throw new HttpError(403, 'Only a super admin can change super-admin accounts');
  if (id === actor.id && input.isActive === false) throw new HttpError(400, 'You cannot deactivate your own account');
  if (existing.role === 'super_admin' && existing.is_active && (input.isActive === false || (input.role && input.role !== 'super_admin'))) {
    const activeSuperAdmins = await prisma.appUser.count({ where: { role: 'super_admin', is_active: true, is_approved: true } });
    if (activeSuperAdmins <= 1) throw new HttpError(409, 'At least one active super admin is required');
  }
  const team = input.teamId === undefined ? undefined : await validateTeam(input.teamId);
  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.appUser.update({ where: { id }, data: { full_name: input.fullName, role: input.role, team_id: input.teamId === undefined ? undefined : team?.id || null, team: input.teamId === undefined ? undefined : team?.name || null, is_active: input.isActive, password_hash: input.password ? await hash(input.password, 12) : undefined, session_version: input.password || input.isActive === false || input.role ? { increment: 1 } : undefined } });
    await tx.profiles.upsert({ where: { email: updated.email }, create: { id: updated.id, email: updated.email, full_name: updated.full_name, role: updated.role, is_approved: updated.is_approved }, update: { full_name: updated.full_name, role: updated.role, is_approved: updated.is_approved } });
    if (input.permissions) { await tx.user_permissions.deleteMany({ where: { user_id: id } }); if (input.permissions.length) await tx.user_permissions.createMany({ data: input.permissions.map((permission) => ({ user_id: id, permission, granted_by: actor.id })) }); }
    return updated;
  });
  await writeAudit(actor, 'crm.user.update', 'app_users', id, { email: existing.email, role: existing.role, is_active: existing.is_active }, { email: user.email, role: user.role, is_active: user.is_active, team_id: user.team_id }, request);
  response.json({ user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, team_id: user.team_id, is_active: user.is_active } });
}));

crmRouter.get('/teams', asyncRoute(async (request, response) => {
  requireManager(request);
  const teams = await prisma.crm_teams.findMany({ include: { manager: { select: { id: true, full_name: true, email: true } }, members: { select: { id: true, full_name: true, email: true, role: true, is_active: true } }, _count: { select: { members: true } } }, orderBy: { name: 'asc' } });
  response.json({ teams });
}));

crmRouter.post('/teams', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const input = z.object({ name: z.string().trim().min(2).max(100), description: z.string().trim().max(500).optional(), managerId: uuid.optional().nullable() }).parse(request.body);
  if (await prisma.crm_teams.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw new HttpError(409, 'A team with this name already exists');
  const manager = await validateTeamManager(input.managerId);
  const team = await prisma.$transaction(async (tx) => {
    const created = await tx.crm_teams.create({ data: { name: input.name, description: input.description, manager_id: manager?.id || null } });
    if (manager) await tx.appUser.update({ where: { id: manager.id }, data: { team_id: created.id, team: created.name } });
    return created;
  });
  await writeAudit(actor, 'crm.team.create', 'crm_teams', team.id, null, team, request);
  response.status(201).json({ team });
}));

crmRouter.patch('/teams/:id', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const id = uuid.parse(request.params.id);
  const existing = await prisma.crm_teams.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Team not found');
  const input = z.object({ name: z.string().trim().min(2).max(100).optional(), description: z.string().trim().max(500).optional().nullable(), managerId: uuid.optional().nullable(), isActive: z.boolean().optional() }).parse(request.body);
  if (input.name && await prisma.crm_teams.findFirst({ where: { id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } })) throw new HttpError(409, 'A team with this name already exists');
  const manager = input.managerId === undefined ? undefined : await validateTeamManager(input.managerId);
  const team = await prisma.$transaction(async (tx) => {
    const updated = await tx.crm_teams.update({ where: { id }, data: { name: input.name, description: input.description, manager_id: input.managerId === undefined ? undefined : manager?.id || null, is_active: input.isActive } });
    if (input.name) await tx.appUser.updateMany({ where: { team_id: id }, data: { team: input.name } });
    if (manager) await tx.appUser.update({ where: { id: manager.id }, data: { team_id: id, team: updated.name } });
    return updated;
  });
  await writeAudit(actor, 'crm.team.update', 'crm_teams', id, existing, team, request);
  response.json({ team });
}));

crmRouter.post('/stages', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const input = z.object({ name: z.string().trim().min(2).max(100), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), isDefault: z.boolean().default(false) }).parse(request.body);
  if (await prisma.pipeline_stages.findFirst({ where: { name: { equals: input.name, mode: 'insensitive' } } })) throw new HttpError(409, 'A lead stage with this name already exists');
  const max = await prisma.pipeline_stages.aggregate({ _max: { sort_order: true } });
  const stage = await prisma.$transaction(async (tx) => { if (input.isDefault) await tx.pipeline_stages.updateMany({ data: { is_default: false } }); return tx.pipeline_stages.create({ data: { name: input.name, color: input.color, is_default: input.isDefault, sort_order: (max._max.sort_order || 0) + 1 } }); });
  await writeAudit(actor, 'crm.stage.create', 'pipeline_stages', stage.id, null, stage, request);
  response.status(201).json({ stage });
}));

crmRouter.patch('/stages/:id', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const id = uuid.parse(request.params.id);
  const existing = await prisma.pipeline_stages.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Stage not found');
  const input = z.object({ name: z.string().trim().min(2).max(100).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), sortOrder: z.number().int().min(0).optional(), isDefault: z.boolean().optional() }).parse(request.body);
  if (input.name && await prisma.pipeline_stages.findFirst({ where: { id: { not: id }, name: { equals: input.name, mode: 'insensitive' } } })) throw new HttpError(409, 'A lead stage with this name already exists');
  const stage = await prisma.$transaction(async (tx) => { if (input.isDefault) await tx.pipeline_stages.updateMany({ data: { is_default: false } }); return tx.pipeline_stages.update({ where: { id }, data: { name: input.name, color: input.color, sort_order: input.sortOrder, is_default: input.isDefault } }); });
  await writeAudit(actor, 'crm.stage.update', 'pipeline_stages', id, existing, stage, request);
  response.json({ stage });
}));

crmRouter.delete('/stages/:id', asyncRoute(async (request, response) => {
  const actor = requireAdminUser(request);
  const id = uuid.parse(request.params.id);
  const [stage, used] = await Promise.all([prisma.pipeline_stages.findUnique({ where: { id } }), prisma.crm_contacts.count({ where: { stage_id: id } })]);
  if (!stage) throw new HttpError(404, 'Stage not found');
  if (stage.is_default) throw new HttpError(409, 'Choose another default stage before deleting this one');
  if (used) throw new HttpError(409, `Move ${used} leads out of this stage before deleting it`);
  await prisma.pipeline_stages.delete({ where: { id } });
  await writeAudit(actor, 'crm.stage.delete', 'pipeline_stages', id, stage, null, request);
  response.status(204).end();
}));

crmRouter.get('/saved-views', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  response.json({ views: await prisma.crm_saved_views.findMany({ where: { user_id: actor.id }, orderBy: [{ is_default: 'desc' }, { name: 'asc' }] }) });
}));

crmRouter.post('/saved-views', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const input = z.object({ name: z.string().trim().min(2).max(80), filters: z.record(z.unknown()), columns: z.array(z.string().max(50)).max(50).default([]), isDefault: z.boolean().default(false) }).parse(request.body);
  const view = await prisma.$transaction(async (tx) => { if (input.isDefault) await tx.crm_saved_views.updateMany({ where: { user_id: actor.id }, data: { is_default: false } }); return tx.crm_saved_views.upsert({ where: { user_id_name: { user_id: actor.id, name: input.name } }, create: { user_id: actor.id, name: input.name, filters: input.filters as any, columns: input.columns, is_default: input.isDefault }, update: { filters: input.filters as any, columns: input.columns, is_default: input.isDefault } }); });
  response.status(201).json({ view });
}));

crmRouter.delete('/saved-views/:id', asyncRoute(async (request, response) => {
  const actor = userOrThrow(request);
  await assertPermission(actor, 'view_leads');
  const id = uuid.parse(request.params.id);
  const deleted = await prisma.crm_saved_views.deleteMany({ where: { id, user_id: actor.id } });
  if (!deleted.count) throw new HttpError(404, 'Saved view not found');
  response.status(204).end();
}));

crmRouter.get('/audit', asyncRoute(async (request, response) => {
  requireAdminUser(request);
  const input = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(50),
    search: z.string().trim().max(150).optional(),
    action: z.string().trim().max(100).optional(),
    resource: z.string().trim().max(100).optional(),
  }).parse(request.query);
  const clauses: any[] = [];
  if (input.action) clauses.push({ action: input.action });
  if (input.resource) clauses.push({ resource: input.resource });
  if (input.search) clauses.push({ OR: [
    { action: { contains: input.search, mode: 'insensitive' } },
    { resource: { contains: input.search, mode: 'insensitive' } },
    { resource_id: { contains: input.search, mode: 'insensitive' } },
    { actor: { is: { OR: [
      { full_name: { contains: input.search, mode: 'insensitive' } },
      { email: { contains: input.search, mode: 'insensitive' } },
    ] } } },
  ] });
  const where = clauses.length ? { AND: clauses } : {};
  const [logs, total, actionRows, resourceRows] = await Promise.all([
    prisma.auditLog.findMany({ where, include: { actor: { select: { full_name: true, email: true } } }, orderBy: { created_at: 'desc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    prisma.auditLog.findMany({ distinct: ['resource'], select: { resource: true }, orderBy: { resource: 'asc' } }),
  ]);
  response.json({ logs, total, page: input.page, pageSize: input.pageSize, pages: Math.max(1, Math.ceil(total / input.pageSize)), actions: actionRows.map((row) => row.action), resources: resourceRows.map((row) => row.resource) });
}));
