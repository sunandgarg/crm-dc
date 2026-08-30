import type { RequestHandler } from 'express';
import type { AsyncRoute } from './types.js';

export function asyncRoute(handler: AsyncRoute): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(handler(request, response, next)).catch(next);
  };
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}
