import { prisma } from '../db.js';
import { logger } from '../logger.js';
import { processLeadBatch } from './leadPush.js';
import { config } from '../config.js';

export async function runQueueBatch(batchId: string) {
  const batch = await prisma.upload_batches.findUnique({ where: { id: batchId } });
  if (!batch || batch.is_paused || batch.is_cancelled || ['paused', 'cancelled', 'stopped'].includes(String(batch.status).toLowerCase())) return { processed: 0, remaining: 0, results: [], stopped: true };
  const pending = await prisma.leads.findMany({ where: { batch_id: batchId, status: 'pending' }, orderBy: { created_at: 'asc' }, take: 100 });
  const university = pending[0] ? await prisma.universities.findUnique({ where: { id: pending[0].university_id } }) : null;
  if (!university) return { processed: 0, remaining: 0, results: [] };
  const tasks = pending.map((lead) => ({
    universityId: lead.university_id,
    batchId,
    leadData: { name: lead.name, email: lead.email, mobile: lead.mobile, state: lead.state || '', city: lead.city || '', course: lead.course || '', specialization: lead.specialization || '', ...((lead.extra_data as Record<string, string>) || {}) },
  }));
  const results = await processLeadBatch(tasks, university.default_push_concurrency || 1);
  await Promise.all(pending.map((lead, index) => prisma.leads.update({ where: { id: lead.id }, data: { status: results[index].status, api_response: results[index].response, processed_at: new Date() } })));
  const remaining = await prisma.leads.count({ where: { batch_id: batchId, status: 'pending' } });
  if (!remaining) await prisma.upload_batches.updateMany({ where: { id: batchId, is_paused: false, is_cancelled: false }, data: { status: 'completed', completed_at: new Date() } });
  return { processed: results.length, remaining, results };
}

export async function runScheduledBatches() {
  const staleBefore = new Date(Date.now() - config.SCHEDULER_STALE_MINUTES * 60_000);
  await prisma.upload_batches.updateMany({ where: { status: 'processing', updated_at: { lt: staleBefore }, is_paused: false, is_cancelled: false }, data: { status: 'scheduled', error_message: 'Recovered after an interrupted worker run' } });
  const due = await prisma.upload_batches.findMany({ where: { status: 'scheduled', scheduled_at: { lte: new Date() }, is_cancelled: false }, orderBy: { scheduled_at: 'asc' }, take: 20 });
  const results: Array<Record<string, unknown>> = [];
  for (const batch of due) {
    const claimed = await prisma.upload_batches.updateMany({ where: { id: batch.id, status: 'scheduled', is_cancelled: false }, data: { status: 'processing' } });
    if (!claimed.count) continue;
    try {
      let processed = 0;
      let remaining = 0;
      do {
        const page = await runQueueBatch(batch.id);
        if ('stopped' in page && page.stopped) { results.push({ batchId: batch.id, processed, status: 'stopped' }); break; }
        processed += page.processed;
        remaining = page.remaining;
        if (!page.processed && remaining) throw new Error('Scheduled batch made no progress');
      } while (remaining > 0);
      if (!results.some((item) => item.batchId === batch.id)) results.push({ batchId: batch.id, processed, status: 'completed' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await prisma.upload_batches.update({ where: { id: batch.id }, data: { status: 'failed', error_message: message } });
      results.push({ batchId: batch.id, processed: 0, status: 'failed', error: message });
    }
  }
  return results;
}

export function startBatchScheduler(intervalSeconds: number) {
  let running = false;
  const execute = async () => {
    if (running) return;
    running = true;
    try {
      const batches = await runScheduledBatches();
      if (batches.length) logger.info({ batches }, 'Scheduled lead batches processed');
    } catch (error) {
      logger.error({ err: error }, 'Scheduled lead batch scan failed');
    } finally {
      running = false;
    }
  };
  void execute();
  const timer = setInterval(() => void execute(), intervalSeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
