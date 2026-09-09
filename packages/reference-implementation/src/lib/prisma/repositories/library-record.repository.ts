import {
  CheckResult,
  CheckRunState,
  CoreCredentialType,
  LibraryRecordOrigin,
  Prisma,
  type CheckRun,
} from '../generated';
import { prisma } from '../prisma';
import {
  LibraryRecordShapeError,
  narrowLibraryRecord,
  type ExternalRecordView,
  type NativeRecordView,
  type LibraryRecordView,
  type ExternalLibraryRecordView,
  type LibraryRecordDetailView,
} from '@/lib/library/library-record-view';
import { BLOCKING_CHECKS, CHECK_NAMES, isNativeMasked, type LibraryCheckName } from '@/lib/library/check-rules';
import type { LibraryOrigin, VerificationSummary } from '@/lib/library/credential-record-projection';
import { DEFAULT_PAGE_LIMIT } from '@/lib/api/pagination';

const LIBRARY_RECORD_INCLUDE = {
  credential: true,
  externalCredential: true,
  checkRuns: {
    orderBy: { generation: 'desc' },
    take: 1,
  },
  // The run's composite foreign key already pins it to the parent's tenant,
  // so a tenant filter here could only ever narrow the newest generation away
  // and serve an older one as current. The list query states the same key
  // explicitly in its raw LATERAL join.
} as const satisfies Prisma.LibraryRecordInclude;

const LIBRARY_RECORD_LIST_INCLUDE = {
  credential: true,
  externalCredential: true,
} as const satisfies Prisma.LibraryRecordInclude;

export const LIBRARY_LIST_SORTS = ['issuedAt:asc', 'issuedAt:desc', 'createdAt:asc', 'createdAt:desc'] as const;
export type LibraryListSort = (typeof LIBRARY_LIST_SORTS)[number];

export type ListLibraryRecordsOptions = {
  tenantId: string;
  type?: readonly CoreCredentialType[];
  origin?: LibraryOrigin;
  organisationId?: string;
  facilityId?: string;
  productId?: string;
  issuer?: string;
  encrypted?: boolean;
  status?: VerificationSummary;
  issuedFrom?: Date;
  issuedTo?: Date;
  sort?: LibraryListSort;
  limit?: number;
  offset?: number;
};

type LibraryListSqlRow = { id: string | null; newestRunId: string | null; total: bigint | number };
type LibraryRecordSelection = { id: string; newestRunId: string | null };

export class LibraryRecordListError extends Error {
  constructor(detail: string) {
    super(`Library record list invariant failed: ${detail}`);
    this.name = 'LibraryRecordListError';
  }
}

function assertLibraryRecordCheckRun<TRecord extends { id: string }>(
  view: NativeRecordView<TRecord>,
  checkRun: CheckRun | null,
): void;
function assertLibraryRecordCheckRun<TRecord extends { id: string }>(
  view: ExternalRecordView<TRecord>,
  checkRun: CheckRun | null,
): asserts checkRun is CheckRun;
function assertLibraryRecordCheckRun<TRecord extends { id: string }>(
  view: LibraryRecordView<TRecord>,
  checkRun: CheckRun | null,
): void {
  if (view.origin === LibraryRecordOrigin.NATIVE) {
    if (checkRun?.generation === 1) {
      throw new LibraryRecordShapeError(view.record.id, 'is NATIVE but has a stored generation 1 check run');
    }
    return;
  }
  if (checkRun === null) {
    throw new LibraryRecordShapeError(view.record.id, 'is EXTERNAL but has no check run');
  }
}

const effectiveIssuedAt = Prisma.sql`COALESCE(r."validFrom", r."createdAt")`;

type PrismaEnumName = 'CheckResult' | 'CheckRunState' | 'LibraryRecordOrigin';

function enumValue(value: string, enumName: PrismaEnumName): Prisma.Sql {
  // enumName is selected only from constants in this module. It is a type
  // name, never caller input, and is therefore safe as a static SQL fragment.
  return Prisma.sql`${value}::${Prisma.raw(`"${enumName}"`)}`;
}

function checkColumn(name: LibraryCheckName): Prisma.Sql {
  // CHECK_NAMES is the repository's fixed seven-column vocabulary. No query
  // parameter is ever used as an identifier here.
  return Prisma.raw(`n."${name}"`);
}

function checkEquals(name: LibraryCheckName, result: CheckResult): Prisma.Sql {
  return Prisma.sql`${checkColumn(name)} = ${enumValue(result, 'CheckResult')}`;
}

function checkNotEquals(name: LibraryCheckName, result: CheckResult): Prisma.Sql {
  return Prisma.sql`${checkColumn(name)} <> ${enumValue(result, 'CheckResult')}`;
}

function summaryIsNotConformant(native: boolean): Prisma.Sql {
  const blocking = BLOCKING_CHECKS.filter((name) => (native && isNativeMasked(name) ? false : true));
  const ran = native ? CHECK_NAMES.filter((name) => !isNativeMasked(name)) : [...CHECK_NAMES];
  const failedBlocking = Prisma.sql`(${Prisma.join(
    blocking.map((name) => checkEquals(name, CheckResult.FAIL)),
    ' OR ',
  )})`;
  const noChecksRan = Prisma.sql`NOT (${Prisma.join(
    ran.map((name) => checkNotEquals(name, CheckResult.NOT_RUN)),
    ' OR ',
  )})`;
  return Prisma.sql`(${failedBlocking} OR ${noChecksRan})`;
}

function summaryIsVerified(native: boolean): Prisma.Sql {
  const blocking = BLOCKING_CHECKS.filter((name) => (native && isNativeMasked(name) ? false : true));
  const ran = native ? CHECK_NAMES.filter((name) => !isNativeMasked(name)) : [...CHECK_NAMES];
  const noBlockingFailure = Prisma.sql`NOT (${Prisma.join(
    blocking.map((name) => checkEquals(name, CheckResult.FAIL)),
    ' OR ',
  )})`;
  const atLeastOneCheck = Prisma.sql`(${Prisma.join(
    ran.map((name) => checkNotEquals(name, CheckResult.NOT_RUN)),
    ' OR ',
  )})`;
  return Prisma.sql`(${noBlockingFailure} AND ${atLeastOneCheck})`;
}

function statusPredicate(status: NonNullable<ListLibraryRecordsOptions['status']>): Prisma.Sql {
  const pending = Prisma.sql`n."state" = ${enumValue(CheckRunState.PENDING, 'CheckRunState')}`;
  const failed = Prisma.sql`n."state" = ${enumValue(CheckRunState.FAILED, 'CheckRunState')}`;
  const complete = Prisma.sql`n."state" = ${enumValue(CheckRunState.COMPLETE, 'CheckRunState')}`;
  const nativeSummary = (summary: Prisma.Sql, noRunIsMatch: boolean) =>
    Prisma.sql`(r."origin" = ${enumValue(LibraryRecordOrigin.NATIVE, 'LibraryRecordOrigin')} AND (${
      noRunIsMatch ? Prisma.sql`n."id" IS NULL OR ` : Prisma.empty
    }(${complete} AND ${summary})))`;
  const externalSummary = (summary: Prisma.Sql) =>
    Prisma.sql`(r."origin" = ${enumValue(
      LibraryRecordOrigin.EXTERNAL,
      'LibraryRecordOrigin',
    )} AND ${complete} AND ${summary})`;

  switch (status) {
    case 'pending':
      return pending;
    case 'failed':
      return failed;
    case 'not_conformant':
      return Prisma.sql`(${nativeSummary(summaryIsNotConformant(true), false)} OR ${externalSummary(
        summaryIsNotConformant(false),
      )})`;
    case 'verified':
      return Prisma.sql`(${nativeSummary(summaryIsVerified(true), true)} OR ${externalSummary(
        summaryIsVerified(false),
      )})`;
    default: {
      const unhandled: never = status;
      throw new LibraryRecordListError(`unsupported status ${String(unhandled)}`);
    }
  }
}

function sortExpression(sort: LibraryListSort): Prisma.Sql {
  switch (sort) {
    case 'issuedAt:asc':
      return Prisma.sql`"effectiveIssuedAt" ASC`;
    case 'issuedAt:desc':
      return Prisma.sql`"effectiveIssuedAt" DESC`;
    case 'createdAt:asc':
      return Prisma.sql`"createdAt" ASC`;
    case 'createdAt:desc':
      return Prisma.sql`"createdAt" DESC`;
    default: {
      const unhandled: never = sort;
      throw new LibraryRecordListError(`unsupported sort ${String(unhandled)}`);
    }
  }
}

/**
 * Builds the bounded id-selection statement for `GET /library`.
 *
 * The filtered CTE is computed once and scanned twice for the page and its
 * anchored count, so an empty or beyond-end page still returns the total.
 * The page id selection, child hydration and newest-run hydration are at
 * most three client operations in the same repeatable-read transaction; the
 * run read is skipped when no selected record has a run. All caller
 * values remain parameters; only fixed enum names, column names and sort
 * branches are SQL fragments.
 */
export function buildLibraryListQuery(options: ListLibraryRecordsOptions): Prisma.Sql {
  const filters: Prisma.Sql[] = [Prisma.sql`r."tenantId" = ${options.tenantId}`];
  if (options.type !== undefined) {
    if (options.type.length === 0) throw new LibraryRecordListError('type filter must not be empty');
    const typeArray = Prisma.sql`ARRAY[${Prisma.join(options.type)}]::"CoreCredentialType"[]`;
    filters.push(
      Prisma.sql`((r."coreCredentialType" IS NOT NULL AND r."coreCredentialType" = ANY(${typeArray})) OR (r."coreCredentialType" IS NULL AND e."declaredCredentialType" = ANY(${typeArray})))`,
    );
  }
  if (options.origin !== undefined) {
    const origin = options.origin === 'native' ? LibraryRecordOrigin.NATIVE : LibraryRecordOrigin.EXTERNAL;
    filters.push(Prisma.sql`r."origin" = ${enumValue(origin, 'LibraryRecordOrigin')}`);
  }
  if (options.organisationId !== undefined) filters.push(Prisma.sql`c."organisationId" = ${options.organisationId}`);
  if (options.facilityId !== undefined) filters.push(Prisma.sql`c."facilityId" = ${options.facilityId}`);
  if (options.productId !== undefined) filters.push(Prisma.sql`c."productId" = ${options.productId}`);
  if (options.issuer !== undefined) {
    filters.push(Prisma.sql`(LOWER(r."issuerName") = LOWER(${options.issuer}) OR r."issuerDid" = ${options.issuer})`);
  }
  if (options.encrypted !== undefined) {
    filters.push(
      Prisma.sql`((r."origin" = ${enumValue(
        LibraryRecordOrigin.NATIVE,
        'LibraryRecordOrigin',
      )} AND (c."decryptionKey" IS NOT NULL) = ${options.encrypted}) OR (r."origin" = ${enumValue(
        LibraryRecordOrigin.EXTERNAL,
        'LibraryRecordOrigin',
      )} AND e."encrypted" = ${options.encrypted}))`,
    );
  }
  if (options.status !== undefined) filters.push(statusPredicate(options.status));
  if (options.issuedFrom !== undefined) {
    filters.push(Prisma.sql`${effectiveIssuedAt} >= ${options.issuedFrom.toISOString().slice(0, -1)}::timestamp(3)`);
  }
  if (options.issuedTo !== undefined) {
    filters.push(Prisma.sql`${effectiveIssuedAt} <= ${options.issuedTo.toISOString().slice(0, -1)}::timestamp(3)`);
  }

  const sort = sortExpression(options.sort ?? 'issuedAt:desc');
  const limit = options.limit ?? DEFAULT_PAGE_LIMIT;
  const offset = options.offset ?? 0;

  return Prisma.sql`
    WITH filtered AS (
      SELECT
        r."id" AS "id",
        ${effectiveIssuedAt} AS "effectiveIssuedAt",
        r."createdAt" AS "createdAt",
        n."id" AS "newestRunId"
      FROM "LibraryRecord" AS r
      LEFT JOIN "Credential" AS c
        ON c."id" = r."id"
       AND c."tenantId" = r."tenantId"
       AND c."origin" = ${enumValue(LibraryRecordOrigin.NATIVE, 'LibraryRecordOrigin')}
      LEFT JOIN "ExternalCredential" AS e
        ON e."id" = r."id"
       AND e."tenantId" = r."tenantId"
       AND e."origin" = ${enumValue(LibraryRecordOrigin.EXTERNAL, 'LibraryRecordOrigin')}
      LEFT JOIN LATERAL (
        SELECT n.*
        FROM "CheckRun" AS n
        WHERE n."recordId" = r."id" AND n."tenantId" = r."tenantId"
        ORDER BY n."generation" DESC
        LIMIT 1
      ) AS n ON TRUE
      WHERE ${Prisma.join(filters, ' AND ')}
    ),
    page AS (
      SELECT
        "id",
        "newestRunId",
        row_number() OVER (ORDER BY ${sort}, "id" ASC) AS "ordinal"
      FROM filtered
      ORDER BY ${sort}, "id" ASC
      LIMIT ${limit} OFFSET ${offset}
    ),
    totals AS (
      SELECT count(*) AS "total"
      FROM filtered
    )
    SELECT
      page."id" AS "id",
      page."newestRunId" AS "newestRunId",
      page."ordinal" AS "ordinal",
      totals."total" AS "total"
    FROM totals
    LEFT JOIN page ON TRUE
    ORDER BY page."ordinal"
  `;
}

function totalAsNumber(total: unknown): number {
  if (typeof total === 'bigint') {
    if (total < BigInt(0) || total > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new LibraryRecordListError('total is outside the safe integer range');
    }
    return Number(total);
  }
  if (typeof total === 'number' && Number.isSafeInteger(total) && total >= 0) return total;
  throw new LibraryRecordListError('total was not a non-negative safe integer');
}

async function hydrateLibraryRecords(
  tx: Prisma.TransactionClient,
  selected: readonly LibraryRecordSelection[],
  tenantId: string,
): Promise<LibraryRecordDetailView[]> {
  if (selected.length === 0) return [];
  const ids = selected.map(({ id }) => id);
  const rows = await tx.libraryRecord.findMany({
    where: { tenantId, id: { in: [...ids] } },
    include: LIBRARY_RECORD_LIST_INCLUDE,
  });
  const newestRunIds = selected.flatMap(({ newestRunId }) => (newestRunId === null ? [] : [newestRunId]));
  const checkRuns =
    newestRunIds.length === 0 ? [] : await tx.checkRun.findMany({ where: { id: { in: newestRunIds }, tenantId } });
  const runsByRecordId = new Map(checkRuns.map((checkRun) => [checkRun.recordId, checkRun]));
  const selectedById = new Map(selected.map((selection) => [selection.id, selection]));
  const byId = new Map<string, LibraryRecordDetailView>();
  for (const row of rows) {
    const selection = selectedById.get(row.id);
    if (selection === undefined) {
      throw new LibraryRecordShapeError(row.id, 'was returned during hydration but was not selected');
    }
    const view = narrowLibraryRecord(row);
    const checkRun = selection.newestRunId === null ? null : runsByRecordId.get(row.id) ?? null;
    if (selection.newestRunId !== null && (checkRun === null || checkRun.id !== selection.newestRunId)) {
      throw new LibraryRecordShapeError(row.id, 'was selected with a newest check run that could not be hydrated');
    }
    if (view.origin === LibraryRecordOrigin.NATIVE) {
      assertLibraryRecordCheckRun(view, checkRun);
      byId.set(row.id, { ...view, checkRun });
    } else {
      assertLibraryRecordCheckRun(view, checkRun);
      byId.set(row.id, { ...view, checkRun });
    }
  }
  if (byId.size !== rows.length || byId.size !== ids.length) {
    const missing = ids.find((id) => !byId.has(id));
    throw new LibraryRecordShapeError(missing ?? 'unknown', 'was selected but could not be hydrated');
  }
  return ids.map((id) => {
    const view = byId.get(id);
    if (view === undefined) throw new LibraryRecordShapeError(id, 'was selected but could not be hydrated');
    return view;
  });
}

/** Lists one tenant's records using the id query and same-transaction hydration. */
export async function listLibraryRecords(
  options: ListLibraryRecordsOptions,
): Promise<{ data: LibraryRecordDetailView[]; total: number }> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LibraryListSqlRow[]>(buildLibraryListQuery(options));
        if (rows.length === 0) throw new LibraryRecordListError('the anchored count returned no row');
        const total = totalAsNumber(rows[0].total);
        if (rows.some((row) => totalAsNumber(row.total) !== total)) {
          throw new LibraryRecordListError('the anchored count changed within the page result');
        }
        const selected: LibraryRecordSelection[] = rows.flatMap((row) =>
          row.id === null ? [] : [{ id: row.id, newestRunId: row.newestRunId }],
        );
        return { data: await hydrateLibraryRecords(tx, selected, options.tenantId), total };
      },
      // The statement is unbenchmarked and has no effective-date expression index yet.
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2_000, timeout: 5_000 },
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2028'
    ) {
      Object.defineProperty(error, 'context', {
        configurable: true,
        value: { query: 'library-list', tenantId: options.tenantId },
      });
    }
    throw error;
  }
}

type LibraryRecordReadClient = Pick<Prisma.TransactionClient, 'libraryRecord'>;

/**
 * An invariant this write transaction had already established failed inside
 * it: the parent lock was held and the row matched, yet the conditional write
 * did not land the single row it had been proved to own, or the record it had
 * just written could not be read back in the shape it was written in.
 *
 * Every throw of this error happens inside the open transaction, so the
 * transaction rolls back and nothing is committed. That is what separates it
 * from `LibraryRecordShapeError`, which names a committed row whose stored
 * shape is broken. A caller answering this one can tell its own caller that
 * the update did not happen, rather than that it may have.
 */
export class LibraryRecordWriteAnomalyError extends Error {
  constructor(recordId: string, detail: string) {
    super(`Library record ${recordId} ${detail}`);
    this.name = 'LibraryRecordWriteAnomalyError';
  }
}

export type LibraryRecordAnnotationChanges = {
  displayName?: string;
  declaredCredentialType?: CoreCredentialType;
  dateReceived?: Date | null;
  notes?: string | null;
};

export type UpdateLibraryRecordAnnotationsResult =
  | { outcome: 'updated'; view: ExternalLibraryRecordView }
  | { outcome: 'missing' }
  | { outcome: 'native' }
  | { outcome: 'version_conflict'; currentVersion: number };

/**
 * Reads and validates one tenant-owned record on the supplied transaction
 * client, so the detail read and the annotation write share one definition of
 * a well-formed record rather than each restating the invariant.
 */
async function readLibraryRecordFromClient(
  tx: LibraryRecordReadClient,
  id: string,
  tenantId: string,
): Promise<LibraryRecordDetailView | null> {
  const row = await tx.libraryRecord.findFirst({
    where: { id, tenantId },
    include: LIBRARY_RECORD_INCLUDE,
  });
  if (!row) return null;

  const { checkRuns, ...withChildren } = row;
  const view = narrowLibraryRecord(withChildren);
  const checkRun = checkRuns[0] ?? null;
  if (view.origin === LibraryRecordOrigin.NATIVE) {
    assertLibraryRecordCheckRun(view, checkRun);
    return { ...view, checkRun };
  }
  assertLibraryRecordCheckRun(view, checkRun);
  return { ...view, checkRun };
}

/**
 * Takes a `FOR UPDATE` row lock on one tenant-owned `LibraryRecord` parent and
 * reports whether the row exists, so a caller can compare and write its child
 * without another writer changing the row in between.
 *
 * `tx` must be an interactive transaction client. The parameter type also
 * admits the global client, which compiles and returns the same value, but a
 * `SELECT ... FOR UPDATE` outside a transaction runs in its own autocommit
 * transaction and releases the lock as the statement returns, so the caller
 * would hold nothing. A branded client that made that unrepresentable is a
 * follow-up, tracked with the adoption below.
 *
 * The convention this helper carries is parent before child. Its callers today
 * are `updateLibraryRecordAnnotations` in this file and, as a character-for-
 * character inline copy pending adoption, `createReverificationGeneration` in
 * `check-run.repository.ts`. `replaceCustody` in
 * `external-credential.repository.ts` takes no parent lock at all, so an
 * annotation update is not serialised against a custody replacement today.
 * That divergence is a recorded follow-up, and `replaceCustody` has no
 * non-test caller yet.
 */
export async function lockLibraryRecordForUpdate(
  tx: Prisma.TransactionClient,
  id: string,
  tenantId: string,
): Promise<boolean> {
  const locked = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    'SELECT "id" FROM "LibraryRecord" WHERE "id" = $1 AND "tenantId" = $2 FOR UPDATE',
    id,
    tenantId,
  );
  return locked.length > 0;
}

/** Builds the tenant-scoped selection for an already-bounded batch-get id list. */
export function buildLibraryBatchGetQuery(tenantId: string, ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`
    SELECT
      r."id" AS "id",
      n."id" AS "newestRunId"
    FROM "LibraryRecord" AS r
    LEFT JOIN LATERAL (
      SELECT n.*
      FROM "CheckRun" AS n
      WHERE n."recordId" = r."id" AND n."tenantId" = r."tenantId"
      ORDER BY n."generation" DESC
      LIMIT 1
    ) AS n ON TRUE
    WHERE r."tenantId" = ${tenantId}
      AND r."id" = ANY(${ids}::text[])
  `;
}

/**
 * Reads the requested tenant-owned records in one repeatable-read snapshot.
 * Exact duplicate ids are deduplicated in first-appearance order, and
 * NUL-bearing ids are dropped before SQL. Missing and foreign ids are omitted
 * by the tenant-scoped selection; a row selected there that cannot be hydrated
 * remains an invariant failure.
 */
export async function batchGetLibraryRecords(options: {
  tenantId: string;
  ids: readonly string[];
}): Promise<LibraryRecordDetailView[]> {
  const requestedIds = [...new Set(options.ids.filter((id) => !id.includes('\0')))];
  if (requestedIds.length === 0) return [];

  try {
    return await prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LibraryRecordSelection[]>(
          buildLibraryBatchGetQuery(options.tenantId, requestedIds),
        );
        const rowsById = new Map(rows.map((row) => [row.id, row]));
        const selected: LibraryRecordSelection[] = requestedIds.flatMap((id) => {
          const row = rowsById.get(id);
          return row === undefined ? [] : [{ id: row.id, newestRunId: row.newestRunId }];
        });
        return hydrateLibraryRecords(tx, selected, options.tenantId);
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2_000, timeout: 5_000 },
    );
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2028'
    ) {
      Object.defineProperty(error, 'context', {
        configurable: true,
        value: { query: 'library-batch-get', tenantId: options.tenantId },
      });
    }
    throw error;
  }
}

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
  return prisma.$transaction((tx) => readLibraryRecordFromClient(tx, id, tenantId), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}

/**
 * Updates only recipient annotations and the two timestamps in one
 * Read-Committed transaction. The parent lock makes the version comparison
 * observe the state immediately before this write and serialises it with
 * cascading deletion.
 *
 * The post-write view is read inside this Read-Committed transaction, so the
 * newest check run it carries can be newer than the annotations beside it: a
 * settlement that commits between the included statements is visible to the
 * run statement. Only the response representation can pair two moments this
 * way; no stored value is ever wrong, and the annotations and the parent
 * timestamp are covered by the parent lock. Repeatable Read would close the
 * pairing and is deliberately not used: a writer queued behind the parent lock
 * would then fail with a serialization error in place of the 409 this contract
 * promises. The read path in `getLibraryRecordById` keeps Repeatable Read,
 * because it takes no lock and has no conflict to lose.
 *
 * `maxWait` bounds a different wait from `timeout`: it is how long the caller
 * queues for a pooled connection before the transaction has begun, while the
 * 15 s `timeout` is the budget for the work once it holds one. The pair matches
 * the other write repositories, so a saturated pool fails fast here while a
 * writer contending for the parent row still has room to acquire it.
 */
export async function updateLibraryRecordAnnotations(input: {
  recordId: string;
  tenantId: string;
  expectedVersion: number;
  changes: LibraryRecordAnnotationChanges;
}): Promise<UpdateLibraryRecordAnnotationsResult> {
  return prisma.$transaction(
    async (tx) => {
      if (!(await lockLibraryRecordForUpdate(tx, input.recordId, input.tenantId))) {
        return { outcome: 'missing' };
      }

      const view = await readLibraryRecordFromClient(tx, input.recordId, input.tenantId);
      if (view === null) return { outcome: 'missing' };
      if (view.origin === LibraryRecordOrigin.NATIVE) return { outcome: 'native' };

      const currentVersion = view.external.annotationVersion;
      if (currentVersion !== input.expectedVersion) {
        return { outcome: 'version_conflict', currentVersion };
      }

      const now = new Date(Date.now());
      const update = await tx.externalCredential.updateMany({
        where: {
          id: input.recordId,
          tenantId: input.tenantId,
          origin: LibraryRecordOrigin.EXTERNAL,
          annotationVersion: input.expectedVersion,
        },
        data: {
          ...input.changes,
          annotationVersion: { increment: 1 },
          updatedAt: now,
        },
      });
      if (update.count !== 1) {
        throw new LibraryRecordWriteAnomalyError(
          input.recordId,
          'was not updated despite holding its parent lock and matching its annotation version',
        );
      }

      await tx.libraryRecord.update({
        where: {
          id_tenantId_origin: {
            id: input.recordId,
            tenantId: input.tenantId,
            origin: LibraryRecordOrigin.EXTERNAL,
          },
        },
        data: { updatedAt: now },
      });

      // The read before the write can legitimately meet committed corruption
      // that predates this transaction, so it keeps `LibraryRecordShapeError`
      // and the "could not be read" classification the pre-check read has. The
      // read-back cannot: the row it inspects is the one this transaction has
      // just written, so a broken shape here is this write's own invariant
      // failing, and the transaction rolls back. Only that call is wrapped, and
      // the original detail is carried across so the log still names it.
      let updatedView: LibraryRecordDetailView | null;
      try {
        updatedView = await readLibraryRecordFromClient(tx, input.recordId, input.tenantId);
      } catch (error) {
        if (error instanceof LibraryRecordShapeError) {
          throw new LibraryRecordWriteAnomalyError(
            input.recordId,
            `was written and read back in a shape the write paths never produce: ${error.message}`,
          );
        }
        throw error;
      }
      if (updatedView === null) {
        throw new LibraryRecordWriteAnomalyError(
          input.recordId,
          'disappeared before the annotation transaction completed',
        );
      }
      // Only an EXTERNAL record reaches this point, so the narrowing states an
      // invariant this transaction has already established rather than
      // handling a case. It also spares every caller a re-check of an origin
      // the repository has proved.
      if (updatedView.origin !== LibraryRecordOrigin.EXTERNAL) {
        throw new LibraryRecordWriteAnomalyError(input.recordId, 'was updated as EXTERNAL but read back as NATIVE');
      }
      return { outcome: 'updated', view: updatedView };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5_000,
      timeout: 15_000,
    },
  );
}
