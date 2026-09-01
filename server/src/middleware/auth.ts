import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthenticatedRequest, AuthUser } from '../types.js';
import { HttpError } from '../http.js';
import { prisma } from '../db.js';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: `${config.SESSION_TTL_HOURS}h`, issuer: 'crm-dc', audience: 'crm-dc-web' });
}

export function readToken(request: AuthenticatedRequest): AuthUser | null {
  const header = request.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, config.JWT_SECRET, { issuer: 'crm-dc', audience: 'crm-dc-web' }) as AuthUser;
  } catch {
    return null;
  }
}

async function freshUser(request: AuthenticatedRequest) {
  const tokenUser = readToken(request);
  if (!tokenUser) return undefined;
  const user = await prisma.appUser.findUnique({ where: { id: tokenUser.id } });
  if (!user?.is_active || !user.is_approved || user.session_version !== tokenUser.sessionVersion) return undefined;
  return { id: user.id, email: user.email, role: user.role, full_name: user.full_name, sessionVersion: user.session_version };
}

export async function optionalAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  try { request.user = await freshUser(request); next(); } catch (error) { next(error); }
}

export async function requireAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  try { request.user = await freshUser(request); } catch (error) { return next(error); }
  if (!request.user) return next(new HttpError(401, 'Authentication required'));
  next();
}

export function requireAdmin(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  if (!request.user) return next(new HttpError(401, 'Authentication required'));
  if (!['admin', 'super_admin'].includes(request.user.role)) return next(new HttpError(403, 'Administrator access required'));
  next();
}
