import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute, HttpError } from '../http.js';
import { config, isProduction } from '../config.js';
import { generateOtp, hashOtp, sendOtpEmail, verifyOtpHash } from '../services/otp.js';
import { requireAuth, signToken } from '../middleware/auth.js';
import { compare } from 'bcryptjs';

const requestSchema = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()) });
const verifySchema = requestSchema.extend({ code: z.string().regex(/^\d{6}$/) });
const passwordSchema = requestSchema.extend({ password: z.string().min(8).max(128) });
const recentRequests = new Map<string, number[]>();

export const authRouter = Router();

function sessionResponse(user: { id: string; email: string; role: string; full_name: string | null; session_version: number }) {
  const authUser = { id: user.id, email: user.email, role: user.role, full_name: user.full_name, sessionVersion: user.session_version };
  return { token: signToken(authUser), user: authUser, expiresIn: config.SESSION_TTL_HOURS * 3600 };
}

authRouter.post('/sign-in-password', asyncRoute(async (request, response) => {
  const { email, password } = passwordSchema.parse(request.body);
  const user = await prisma.appUser.findUnique({ where: { email } });
  if (!user?.is_active || !user.is_approved || !user.password_hash || !(await compare(password, user.password_hash))) {
    throw new HttpError(401, 'Invalid email or password');
  }
  await prisma.appUser.update({ where: { id: user.id }, data: { last_sign_in_at: new Date() } });
  response.json(sessionResponse(user));
}));

authRouter.post('/request-otp', asyncRoute(async (request, response) => {
  const { email } = requestSchema.parse(request.body);
  const now = Date.now();
  const attempts = (recentRequests.get(email) ?? []).filter((timestamp) => now - timestamp < 15 * 60_000);
  if (attempts.length >= 5) throw new HttpError(429, 'Too many OTP requests. Try again later.');
  recentRequests.set(email, [...attempts, now]);
  if (recentRequests.size > 10_000) {
    for (const [key, timestamps] of recentRequests) if (!timestamps.some((timestamp) => now - timestamp < 15 * 60_000)) recentRequests.delete(key);
    while (recentRequests.size > 10_000) recentRequests.delete(recentRequests.keys().next().value as string);
  }

  let user = await prisma.appUser.findUnique({ where: { email } });
  if (!user && !isProduction) {
    user = await prisma.appUser.create({
      data: { email, full_name: email.split('@')[0], role: email === config.BOOTSTRAP_ADMIN_EMAIL ? 'super_admin' : 'admin' },
    });
  }

  // Keep the response indistinguishable for unknown or inactive accounts.
  if (!user?.is_active || !user.is_approved) return response.json({ success: true });
  const recentCodes = await prisma.otpCode.count({ where: { user_id: user.id, created_at: { gt: new Date(now - 15 * 60_000) } } });
  if (recentCodes >= 5) return response.json({ success: true });

  const code = generateOtp();
  await prisma.otpCode.create({
    data: {
      user_id: user.id,
      code_hash: await hashOtp(code),
      expires_at: new Date(now + config.OTP_TTL_MINUTES * 60_000),
    },
  });
  await sendOtpEmail(email, code);

  response.json({ success: true, ...(isProduction ? {} : { developmentCode: code }) });
}));

authRouter.post('/verify-otp', asyncRoute(async (request, response) => {
  const { email, code } = verifySchema.parse(request.body);
  const user = await prisma.appUser.findUnique({ where: { email } });
  if (!user?.is_active || !user.is_approved) throw new HttpError(401, 'Invalid or expired code');

  const otp = await prisma.otpCode.findFirst({
    where: { user_id: user.id, consumed_at: null, expires_at: { gt: new Date() } },
    orderBy: { created_at: 'desc' },
  });
  if (!otp || otp.attempts >= config.OTP_MAX_ATTEMPTS) throw new HttpError(401, 'Invalid or expired code');

  const matches = await verifyOtpHash(code, otp.code_hash);
  if (!matches) {
    await prisma.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    throw new HttpError(401, 'Invalid or expired code');
  }

  await prisma.$transaction([
    prisma.otpCode.update({ where: { id: otp.id }, data: { consumed_at: new Date() } }),
    prisma.appUser.update({ where: { id: user.id }, data: { last_sign_in_at: new Date() } }),
    prisma.profiles.upsert({
      where: { email: user.email },
      create: { id: user.id, email: user.email, full_name: user.full_name, role: user.role, is_approved: true, last_sign_in_at: new Date() },
      update: { full_name: user.full_name, role: user.role, is_approved: true, last_sign_in_at: new Date() },
    }),
  ]);

  response.json(sessionResponse(user));
}));

authRouter.get('/me', requireAuth, asyncRoute(async (request, response) => {
  response.json({ user: request.user });
}));
