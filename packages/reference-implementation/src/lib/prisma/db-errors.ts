import { ConflictError, NotFoundError } from '@/lib/api/errors';
import { ValidationError } from '@/lib/api/validation';

/**
 * Database error detection and mapping.
 *
 * Prisma errors are detected by duck-typing rather than `instanceof` against the
 * generated client's classes: errors that cross transaction callbacks or module
 * boundaries do not reliably satisfy `instanceof`, and the duck-type keeps this
 * module free of a dependency on the generated client. Error codes are Prisma's
 * documented request-error codes:
 * https://www.prisma.io/docs/orm/reference/error-reference
 */

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  // Gated on isDatabaseError so a non-Prisma error that happens to carry a
  // matching `code` string is never misclassified as a constraint violation.
  if (!isDatabaseError(error)) return false;
  const candidate = error as { code?: unknown };
  return typeof candidate.code === 'string' && candidate.code === code;
}

/** P2002: a unique-constraint violation (the record already exists). */
export function isUniqueConstraintViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2002');
}

/** P2003: a foreign-key violation (a referenced record does not exist, or dependants block the write). */
export function isForeignKeyViolation(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2003');
}

/** P2025: the record required by the operation was not found (e.g. update/delete raced a delete). */
export function isRecordNotFound(error: unknown): boolean {
  return hasPrismaErrorCode(error, 'P2025');
}

/**
 * True for any error thrown by the Prisma client (known request errors,
 * client-side validation errors, initialisation errors, etc.). All Prisma
 * client errors carry `clientVersion` and a `PrismaClient*` name.
 */
export function isDatabaseError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if ('clientVersion' in error) return true;
  return (
    'name' in error &&
    typeof (error as { name: unknown }).name === 'string' &&
    (error as { name: string }).name.startsWith('PrismaClient')
  );
}

/**
 * Contextual messages for the database errors a call site expects, keyed by
 * outcome: `conflict` (P2002 -> ConflictError, 409), `notFound` (P2025 ->
 * NotFoundError, 404), `invalidReference` (P2003 -> ValidationError, 400).
 * Provide a message only for the outcomes the operation can actually produce;
 * anything else rethrows unchanged. At least one key is required: a call with
 * no context is a plain rethrow and should not be written as a mapping.
 *
 * A P2003 raised by a delete usually means an onDelete: Restrict relation
 * blocked it, which a surface may treat as a conflict rather than a bad
 * reference; call sites needing that semantic use the exported guards
 * directly instead of `invalidReference`.
 */
export type DatabaseErrorContext =
  | { conflict: string; notFound?: string; invalidReference?: string }
  | { conflict?: string; notFound: string; invalidReference?: string }
  | { conflict?: string; notFound?: string; invalidReference: string };

/**
 * Maps a caught database error to the API's error contract, with a message
 * that carries the caller's context (which resource conflicted, what was not
 * found). Rethrows the original error unchanged when it is not a database
 * error at all, or when the context does not cover its code. Rethrown
 * database errors land in handleRouteError's sanitised database branch;
 * a non-database error rethrown here follows the same path it would have
 * taken without the mapping.
 */
export function mapDatabaseError(error: unknown, context: DatabaseErrorContext): never {
  if (!isDatabaseError(error)) {
    throw error;
  }
  if (context.conflict !== undefined && isUniqueConstraintViolation(error)) {
    throw new ConflictError(context.conflict);
  }
  if (context.notFound !== undefined && isRecordNotFound(error)) {
    throw new NotFoundError(context.notFound);
  }
  if (context.invalidReference !== undefined && isForeignKeyViolation(error)) {
    throw new ValidationError(context.invalidReference);
  }
  throw error;
}
