import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { asyncRoute, HttpError } from '../http.js';
import { requireAuth } from '../middleware/auth.js';
import { config } from '../config.js';
import { createDownloadUrl, createUploadUrl } from '../services/storage.js';

const uploadSchema = z.object({
  fileName: z.string().min(1).max(180),
  contentType: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive().max(50 * 1024 * 1024),
  scope: z.enum(['imports', 'documents', 'templates', 'exports']).default('documents'),
});

export const storageRouter = Router();
storageRouter.use(requireAuth);

storageRouter.post('/presign-upload', asyncRoute(async (request, response) => {
  const input = uploadSchema.parse(request.body);
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]+/g, '-');
  const objectKey = `${input.scope}/${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeName}`;
  const asset = await prisma.fileAsset.create({
    data: { object_key: objectKey, bucket: config.STORAGE_BUCKET, content_type: input.contentType, size_bytes: BigInt(input.sizeBytes), owner_id: request.user!.id },
  });
  response.status(201).json({ assetId: asset.id, objectKey, uploadUrl: await createUploadUrl(objectKey, input.contentType), expiresIn: 600 });
}));

storageRouter.get('/:assetId/download', asyncRoute(async (request, response) => {
  const asset = await prisma.fileAsset.findUnique({ where: { id: String(request.params.assetId) } });
  if (!asset) throw new HttpError(404, 'File not found');
  response.json({ downloadUrl: await createDownloadUrl(asset.object_key), expiresIn: 600 });
}));
