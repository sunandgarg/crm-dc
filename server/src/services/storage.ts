import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { config } from '../config.js';

const credentials = config.STORAGE_ACCESS_KEY_ID && config.STORAGE_SECRET_ACCESS_KEY ? {
  accessKeyId: config.STORAGE_ACCESS_KEY_ID,
  secretAccessKey: config.STORAGE_SECRET_ACCESS_KEY,
} : undefined;

export const objectStorage = new S3Client({
  region: config.STORAGE_REGION,
  endpoint: config.STORAGE_ENDPOINT,
  credentials,
  forcePathStyle: Boolean(config.STORAGE_ENDPOINT?.includes('localhost')),
});

export async function createUploadUrl(objectKey: string, contentType: string) {
  const command = new PutObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: objectKey, ContentType: contentType });
  return getSignedUrl(objectStorage, command, { expiresIn: 600 });
}

export async function createDownloadUrl(objectKey: string) {
  if (config.STORAGE_PUBLIC_BASE_URL) return `${config.STORAGE_PUBLIC_BASE_URL.replace(/\/$/, '')}/${objectKey}`;
  const command = new GetObjectCommand({ Bucket: config.STORAGE_BUCKET, Key: objectKey });
  return getSignedUrl(objectStorage, command, { expiresIn: 600 });
}
