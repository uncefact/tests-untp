/**
 * Test fixtures mirroring the error shapes the Prisma client throws, for
 * suites that mock the client instead of running one. Kept beside
 * db-errors.ts, whose duck-typed guards these shapes must satisfy;
 * db-errors.test.ts anchors the shape against the real
 * Prisma.PrismaClientKnownRequestError class so the fixtures and the guards
 * cannot drift together.
 */
export function prismaError(
  code: 'P2002' | 'P2003' | 'P2025' | 'P2034' | 'P2010',
  message = 'Prisma request error',
  meta?: Record<string, unknown>,
): Error {
  const error = new Error(message);
  error.name = 'PrismaClientKnownRequestError';
  Object.assign(error, { code, clientVersion: '6.19.2', ...(meta === undefined ? {} : { meta }) });
  return error;
}

export const prismaUniqueConstraintError = (message?: string): Error => prismaError('P2002', message);
export const prismaForeignKeyViolationError = (message?: string): Error => prismaError('P2003', message);
export const prismaRecordNotFoundError = (message?: string): Error => prismaError('P2025', message);
export const prismaTransactionWriteConflictError = (): Error =>
  prismaError('P2034', 'Transaction failed due to a write conflict or a deadlock');
/** A raw-query failure (`$queryRawUnsafe`), meta carrying the underlying database error code. */
export const prismaRawQueryError = (dbCode: string): Error =>
  prismaError('P2010', 'Raw query failed', { code: dbCode, message: `error: ${dbCode}` });
