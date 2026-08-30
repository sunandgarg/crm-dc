import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  full_name?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUser;
}

export type AsyncRoute = (request: AuthenticatedRequest, response: import('express').Response, next: import('express').NextFunction) => Promise<unknown>;
