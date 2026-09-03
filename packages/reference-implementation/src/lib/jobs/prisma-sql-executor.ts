import type { Prisma } from '@/lib/prisma/generated';
import type { SqlExecutor } from './types';

/**
 * Adapts a Prisma interactive-transaction client to the {@link SqlExecutor}
 * the queue's transactional send takes, so a job is inserted through the
 * caller's own open transaction and commits with the caller's rows or not at
 * all (ADR-054 decision 4). The queue's SQL uses positional `$n` placeholders,
 * which Prisma passes to Postgres unchanged.
 *
 * pg-boss ships the same adapter as `fromPrisma`, with one difference: it
 * turns a result that is not an array into an empty row set, which the queue
 * reads as "no job inserted" and the send then reports as null. A shape the
 * contract never produces is a broken adapter, not an empty result, so this
 * one throws. It also keeps only type imports, so a repository can take it
 * without loading pg-boss's ESM-only build, which the unit test runtime
 * cannot parse.
 */
export function prismaSqlExecutor(tx: Prisma.TransactionClient): SqlExecutor {
  return {
    async executeSql(text: string, values: unknown[] = []): Promise<{ rows: unknown[] }> {
      const rows = await tx.$queryRawUnsafe<unknown[]>(text, ...values);
      if (!Array.isArray(rows)) {
        throw new Error(`The SQL executor expected a row set from the transaction client and got ${typeof rows}`);
      }
      return { rows };
    },
  };
}
