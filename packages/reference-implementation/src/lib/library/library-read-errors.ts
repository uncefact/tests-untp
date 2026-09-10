/**
 * The public vocabulary a library collection read uses to name an id it could
 * not return, plus the one error class that says a read's selection cannot be
 * trusted at all.
 *
 * `LibraryReadFailure` is built here rather than reusing
 * `ValidationFailure` from `@uncefact/untp-utils`, which is the workspace's
 * incumbent multi-failure entry (ADR-035). That type is a diagnostic carried
 * on a thrown error: it has no `id`, which is the whole point of this one, and
 * its optional `received` and `expected` fields carry the offending value,
 * which is exactly what a library read must never return to a caller.
 * `CredentialRecordWarning` is closer in audience but is a per-record
 * advisory on a record that WAS returned, not a per-id outcome in place of
 * one.
 */
import { StructuredError } from '@uncefact/untp-utils';
import { z } from 'zod';

export const libraryReadFailureCodeSchema = z.enum(['RECORD_UNREADABLE', 'NOT_FOUND']);
export type LibraryReadFailureCode = z.infer<typeof libraryReadFailureCodeSchema>;

export const libraryReadFailureSchema = z
  .object({
    id: z
      .string()
      .describe(
        'The id this outcome belongs to: on batch-get the id as the caller submitted it, on the list route the id the page selected. Never an id read off an internal error.',
      ),
    code: libraryReadFailureCodeSchema.describe(
      'RECORD_UNREADABLE: the record belongs to the caller and exists, but could not be read. Stored state this contract cannot represent is the usual cause; the code also covers any other fault local to that one record, so it is not by itself proof that the stored record is damaged. NOT_FOUND: there is no such record for this caller, which covers a missing id, an id owned by another tenant and an id carrying a NUL character, without distinguishing them.',
    ),
    message: z
      .string()
      .describe(
        'What the caller can act on. RECORD_UNREADABLE asks them to quote the id and the x-correlation-id response header to the operator; NOT_FOUND is one constant sentence.',
      ),
  })
  .strict()
  .describe(
    'One id a read could not return, reported beside the records it could. NOT_FOUND is emitted by batch-get only: the list route reports the ids its own page selected, so every list failure carries RECORD_UNREADABLE.',
  );

export type LibraryReadFailure = z.infer<typeof libraryReadFailureSchema>;

/** The one sentence a caller reads for an id this tenant holds no record of. */
export const NOT_FOUND_LIBRARY_READ_MESSAGE = 'No such credential record.';

/**
 * What a caller reads for a record of theirs that could not be read. It says
 * the record exists and is theirs, because that is what tells them to raise it
 * with an operator rather than re-check their own id, and it names the id and
 * the correlation header because those two values are what lets an operator
 * find the single degradation event logged for this row.
 */
export function recordUnreadableMessage(recordId: string): string {
  return `The library record exists and belongs to this tenant but could not be read. Quote record id "${recordId}" and the x-correlation-id response header when contacting support.`;
}

/**
 * A read result violated the caller's selection boundary rather than one row's
 * shape: rows came back that the read did not select, or an id has more or
 * fewer than one outcome. Distinct from `LibraryRecordListError`, declared in
 * `src/lib/prisma/repositories/library-record.repository.ts`, which is about
 * the query the route asked for (an unsupported sort, an unsafe total). This
 * one lives here because both the repository and `library-read-results.ts`
 * raise it, while that one is the repository's alone. Both end at the same
 * sanitised 500, because neither can be attributed to a single id.
 */
export class LibraryRecordSelectionError extends StructuredError {
  readonly reason = 'selection-boundary' as const;

  constructor(detail: string, cause?: unknown) {
    super({
      code: 'library.selection-boundary',
      message: `Library record selection boundary failed: ${detail}`,
      ...(cause === undefined ? {} : { cause }),
    });
  }
}
