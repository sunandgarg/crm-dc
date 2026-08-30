import type { NextFunction, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import type { AuthenticatedRequest, AuthUser } from '../types.js';
import { HttpError } from '../http.js';

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: '12h', issuer: 'crm-dc' });
}

export function readToken(request: AuthenticatedRequest): AuthUser | null {
  const header = request.header('authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, config.JWT_SECRET, { issuer: 'crm-dc' }) as AuthUser;
  } catch {
    return null;
  }
}

export function optionalAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  request.user = readToken(request) ?? undefined;
  next();
}

export function requireAuth(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  request.user = readToken(request) ?? undefined;
  if (!request.user) return next(new HttpError(401, 'Authentication required'));
  next();
}

export function requireAdmin(request: AuthenticatedRequest, _response: Response, next: NextFunction) {
  if (!request.user) return next(new HttpError(401, 'Authentication required'));
  if (!['admin', 'super_admin'].includes(request.user.role)) return next(new HttpError(403, 'Administrator access required'));
  next();
}
