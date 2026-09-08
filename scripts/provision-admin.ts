import 'dotenv/config';
import { hash } from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
if (!email || !/^\S+@\S+\.\S+$/.test(email)) throw new Error('ADMIN_EMAIL must be a valid email address');
if (password.length < 8 || password.length > 128) throw new Error('ADMIN_PASSWORD must be between 8 and 128 characters');

const prisma = new PrismaClient();
try {
  const passwordHash = await hash(password, 12);
  const user = await prisma.appUser.upsert({
    where: { email },
    create: { email, full_name: process.env.ADMIN_NAME || 'Super Administrator', role: 'super_admin', is_active: true, is_approved: true, password_hash: passwordHash },
    update: { full_name: process.env.ADMIN_NAME || undefined, role: 'super_admin', is_active: true, is_approved: true, password_hash: passwordHash, session_version: { increment: 1 } },
  });
  await prisma.profiles.upsert({
    where: { email },
    create: { id: user.id, email, full_name: user.full_name, role: 'super_admin', is_approved: true },
    update: { full_name: user.full_name, role: 'super_admin', is_approved: true },
  });
  console.log(`Provisioned ${email} as super_admin`);
} finally {
  await prisma.$disconnect();
}
