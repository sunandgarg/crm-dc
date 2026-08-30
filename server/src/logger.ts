import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: [
      'req.headers.authorization',
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
