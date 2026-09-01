import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../http.js';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(name: string, windowMs: number, max: number, key?: (request: Request) => string) {
  return (request: Request, response: Response, next: NextFunction) => {
    const now = Date.now();
    const bucketKey = `${name}:${key?.(request) ?? request.ip}`;
    let bucket = buckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= now) bucket = { count: 0, resetAt: now + windowMs };
    bucket.count += 1;
    buckets.set(bucketKey, bucket);
    response.setHeader('RateLimit-Limit', String(max));
    response.setHeader('RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    response.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (buckets.size > 20_000) {
      for (const [entry, value] of buckets) if (value.resetAt <= now) buckets.delete(entry);
      while (buckets.size > 20_000) buckets.delete(buckets.keys().next().value as string);
    }
    if (bucket.count > max) return next(new HttpError(429, 'Too many requests. Try again later.'));
    next();
  };
}
