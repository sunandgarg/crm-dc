import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers.x-api-key',
      'req.headers.x-webhook-secret',
      'req.headers.x-hub-signature-256',
      'password',
      'otp',
      'code',
      'secret_key',
      'auth_header_value',
      '*.secret_key',
      '*.auth_header_value',
    ],
    censor: '[redacted]',
  },
});
