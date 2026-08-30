import { randomInt } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';
import { config, isProduction } from '../config.js';
import { logger } from '../logger.js';

const ses = new SESv2Client({ region: config.AWS_REGION });

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export function hashOtp(code: string): Promise<string> {
  return bcrypt.hash(code, 10);
}

export function verifyOtpHash(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  if (!config.SES_FROM_EMAIL) {
    if (isProduction) throw new Error('SES_FROM_EMAIL is required in production');
    logger.info({ email }, 'SES is not configured; development OTP generated');
    return;
  }

  await ses.send(new SendEmailCommand({
    FromEmailAddress: config.SES_FROM_EMAIL,
    Destination: { ToAddresses: [email] },
    Content: {
      Simple: {
        Subject: { Data: 'Your DC CRM sign-in code', Charset: 'UTF-8' },
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `<div style="font-family:Arial,sans-serif;color:#172235"><h2>DC CRM sign-in</h2><p>Your one-time code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:4px">${code}</p><p>This code expires in ${config.OTP_TTL_MINUTES} minutes. If you did not request it, ignore this email.</p></div>`,
          },
          Text: { Charset: 'UTF-8', Data: `Your DC CRM code is ${code}. It expires in ${config.OTP_TTL_MINUTES} minutes.` },
        },
      },
    },
  }));
}

export async function sendEmail(input: { to: string[]; subject: string; html?: string; text?: string }): Promise<void> {
  if (!config.SES_FROM_EMAIL) {
    if (isProduction) throw new Error('SES_FROM_EMAIL is required in production');
    logger.info({ recipients: input.to.length, subject: input.subject }, 'SES is not configured; development email skipped');
    return;
  }
  await ses.send(new SendEmailCommand({
    FromEmailAddress: config.SES_FROM_EMAIL,
    Destination: { ToAddresses: input.to },
    Content: { Simple: {
      Subject: { Data: input.subject, Charset: 'UTF-8' },
      Body: {
        ...(input.html ? { Html: { Data: input.html, Charset: 'UTF-8' } } : {}),
        Text: { Data: input.text || input.html?.replace(/<[^>]+>/g, ' ') || '', Charset: 'UTF-8' },
      },
    } },
  }));
}
