import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.BOOTSTRAP_ADMIN_EMAIL) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required for production seeding');
  const adminEmail = String(process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com').toLowerCase();
  const admin = await prisma.appUser.upsert({
    where: { email: adminEmail },
    create: { email: adminEmail, full_name: process.env.BOOTSTRAP_ADMIN_NAME || 'CRM Administrator', role: 'super_admin' },
    update: { is_active: true, is_approved: true, role: 'super_admin' },
  });
  await prisma.profiles.upsert({
    where: { email: admin.email },
    create: { id: admin.id, email: admin.email, full_name: admin.full_name, role: admin.role, is_approved: true },
    update: { full_name: admin.full_name, role: admin.role, is_approved: true },
  });

  const stageDefinitions = [
    ['Inquiry', '#2563eb'], ['Contacted', '#0891b2'], ['Follow-up', '#d97706'],
    ['Application', '#7c3aed'], ['Enrolled', '#16a34a'], ['Lost', '#dc2626'],
  ];
  const stages = [];
  for (let index = 0; index < stageDefinitions.length; index += 1) {
    const [name, color] = stageDefinitions[index];
    stages.push(await prisma.pipeline_stages.upsert({ where: { name }, create: { name, color, sort_order: index, is_default: index === 0 }, update: { color, sort_order: index } }));
  }

  if (process.env.NODE_ENV === 'production' && process.env.SEED_DEMO_DATA !== 'true') return;

  const university = await prisma.universities.upsert({
    where: { id: '11111111-1111-4111-8111-111111111111' },
    create: {
      id: '11111111-1111-4111-8111-111111111111', name: 'Demo University', api_url: 'https://example.com/api/leads', college_id: 'configure-me', secret_key: 'configure-me',
      source: 'DekhoCampus', medium: 'CRM', campaign: 'Admissions', api_type: 'nopaperforms', status: 'Active', daily_lead_limit: 500,
      column_mapping: { name: 'name', email: 'email', mobile: 'mobile', state: 'state', city: 'city', course: 'course', specialization: 'specialization' },
    },
    update: {},
  });

  const contacts = [
    { id: '21111111-1111-4111-8111-111111111111', name: 'Aarav Sharma', email: 'aarav@example.com', mobile: '9876500001', source: 'Google Ads', course: 'MBA', city: 'Delhi', priority: 'High', lead_score: 86, stage_id: stages[2].id, assigned_to: admin.full_name },
    { id: '21111111-1111-4111-8111-111111111112', name: 'Meera Iyer', email: 'meera@example.com', mobile: '9876500002', source: 'Website', course: 'B.Tech', city: 'Bengaluru', priority: 'Medium', lead_score: 72, stage_id: stages[3].id, assigned_to: admin.full_name },
    { id: '21111111-1111-4111-8111-111111111113', name: 'Kabir Khan', email: 'kabir@example.com', mobile: '9876500003', source: 'Referral', course: 'BBA', city: 'Mumbai', priority: 'Low', lead_score: 54, stage_id: stages[0].id, assigned_to: null },
  ];
  for (const contact of contacts) await prisma.crm_contacts.upsert({ where: { id: contact.id }, create: { ...contact, university_id: university.id }, update: {} });

  await prisma.crm_activities.upsert({
    where: { id: '31111111-1111-4111-8111-111111111111' },
    create: { id: '31111111-1111-4111-8111-111111111111', contact_id: contacts[0].id, type: 'call', title: 'Counselling call', description: 'Discussed MBA specializations and application documents.', outcome: 'Follow-up scheduled', duration_minutes: 18, completed_at: new Date() },
    update: {},
  });
  await prisma.crm_tasks.upsert({
    where: { id: '41111111-1111-4111-8111-111111111111' },
    create: { id: '41111111-1111-4111-8111-111111111111', contact_id: contacts[0].id, title: 'Collect graduation marksheet', priority: 'high', assigned_to: admin.full_name, due_at: new Date(Date.now() + 86_400_000) },
    update: {},
  });
  await prisma.automation_rules.upsert({
    where: { id: '51111111-1111-4111-8111-111111111111' },
    create: { id: '51111111-1111-4111-8111-111111111111', name: 'Assign hot leads', description: 'Route leads scoring 80 or higher to the senior counselling queue.', conditions: [{ field: 'lead_score', operator: 'gte', value: 80 }], actions: [{ type: 'assign_team', value: 'Senior Counselling' }] },
    update: {},
  });
  await prisma.feature_toggles.createMany({ data: [
    { feature_key: 'crm_lead_manager', name: 'CRM Lead Manager', is_enabled: true },
    { feature_key: 'lead_push', name: 'Lead Push', is_enabled: true },
    { feature_key: 'automation', name: 'Automation', is_enabled: true },
    { feature_key: 'marketing', name: 'Marketing', is_enabled: true },
  ], skipDuplicates: true });
}

main().finally(() => prisma.$disconnect());
