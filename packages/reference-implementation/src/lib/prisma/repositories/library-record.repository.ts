import { LibraryRecordOrigin, Prisma } from '../generated';
import { prisma } from '../prisma';
import {
  LibraryRecordShapeError,
  narrowLibraryRecord,
  type LibraryRecordDetailView,
} from '@/lib/library/library-record-view';

/**
 * Reads one tenant-owned library record with the single child its origin has
 * (ADR-053 decision 1) and its newest verification run.
 *
 * The read is one repeatable-read transaction because Prisma loads included
 * relations with separate statements: without it a custody child and a run
 * could be paired across a concurrent settlement or custody replacement, and
 * the caller would be handed a mixture of two states.
 *
 * A native record's generation 1 is the issuance assertion, synthesised at
 * read time and never stored (ADR-053 decision 4), so a stored generation 1
 * on a native record is a broken invariant. An external record's generation 1
 * is written with the record, so a missing run is the same kind of failure.
 * Both fail here rather than being projected into a plausible answer.
 */
export async function getLibraryRecordById(id: string, tenantId: string): Promise<LibraryRecordDetailView | null> {
  return prisma.$transaction(
    async (tx) => {
      const row = await tx.libraryRecord.findFirst({
        where: { id, tenantId },
        include: {
          credential: true,
          externalCredential: true,
          // The run's composite foreign key already pins it to the parent's
          // tenant, so a tenant filter here could only ever narrow the newest
          // generation away and serve an older one as current.
          checkRuns: {
            orderBy: { generation: 'desc' },
            take: 1,
          },
        },
      });
      if (!row) return null;

      const { checkRuns, ...withChildren } = row;
      const view = narrowLibraryRecord(withChildren);
      const checkRun = checkRuns[0] ?? null;

      if (view.origin === LibraryRecordOrigin.NATIVE) {
        if (checkRun?.generation === 1) {
          throw new LibraryRecordShapeError(id, 'is NATIVE but has a stored generation 1 check run');
        }
        return { ...view, checkRun };
      }
      if (checkRun === null) {
        throw new LibraryRecordShapeError(id, 'is EXTERNAL but has no check run');
      }
      return { ...view, checkRun };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
