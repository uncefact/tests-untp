import { apiLogger } from '@/lib/api/logger';
import { databaseUrlFromEnvParts } from '@/lib/prisma/database-url';
import { JobQueueError } from './errors';
import { PgBossJobQueue } from './pg-boss-job-queue';
import type { JobQueue } from './types';
import { SENDING_QUEUES } from './queue-names';

/**
 * The one job queue of this process (ADR-054 decision 3), built on the same
 * database the Prisma client uses, so a transactional send commits with the
 * caller's rows. The web process starts it at boot and only sends; the
 * worker process (#985) registers handlers on it and works. Lazy on first
 * use as well as at boot, so a route that runs before the boot hook has
 * settled, or in a test process with no boot at all, still finds a started
 * queue rather than a half-built one.
 */

const logger = apiLogger.child({ module: 'job-queue' });

let instance: PgBossJobQueue | undefined;
let started: Promise<JobQueue> | undefined;

function connectionString(): string {
  const url = process.env.RI_DATABASE_URL ?? databaseUrlFromEnvParts();
  if (!url) {
    throw new JobQueueError({
      code: 'jobs.database-url-missing',
      message: 'RI_DATABASE_URL (or the RI_POSTGRES_* parts) must be set for the job queue',
    });
  }
  return url;
}

function getJobQueue(): PgBossJobQueue {
  instance ??= new PgBossJobQueue({
    connectionString: connectionString(),
    onError: (error) => logger.error({ err: error }, 'Job queue reported an error'),
  });
  return instance;
}

/** The process's queue, started. Concurrent callers share one start. */
export function startJobQueue(): Promise<JobQueue> {
  started ??= (async () => {
    const queue = getJobQueue();
    try {
      await queue.start();
      // Every queue this process sends to is created here, on the boot path
      // and the lazy path alike, so a transactional send is one insert and
      // never holds the caller's transaction open across queue creation.
      for (const name of SENDING_QUEUES) {
        await queue.declareQueue(name);
      }
    } catch (error) {
      started = undefined;
      throw error;
    }
    logger.info({ queues: SENDING_QUEUES }, 'Job queue started; sending queues declared');
    return queue;
  })();
  return started;
}

/** Stops the queue if it was ever built. Safe to call more than once. */
export async function stopJobQueue(): Promise<void> {
  const queue = instance;
  instance = undefined;
  started = undefined;
  if (queue !== undefined) {
    await queue.stop();
  }
}
