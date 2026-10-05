import { z } from 'zod';

/**
 * The fixed grammar of a library record tag (#1108): lowercase ASCII letters
 * and digits, with single hyphens only between them. It refuses uppercase,
 * spaces, underscores, non-ASCII characters, NUL and the empty string. The
 * grammar is the same for every deployment; only the count and length limits
 * are configurable (`src/lib/api/library-tag-limits.ts`).
 *
 * Values are checked as sent and never trimmed, lower-cased, sorted or
 * de-duplicated, so a tag reads back exactly as it was written.
 */
export const LIBRARY_TAG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** States the rule without echoing the submitted value. */
export const LIBRARY_TAG_FORMAT_MESSAGE = 'must be lowercase letters and digits, with single hyphens between them';

/**
 * One tag. Used wherever a tag is admitted (request bodies) and wherever one
 * is matched (list query values). Responses do not apply it: a stored tag is
 * returned as stored.
 */
export const libraryTagSchema = z
  .string({ invalid_type_error: 'must be a string' })
  .regex(LIBRARY_TAG_PATTERN, { message: LIBRARY_TAG_FORMAT_MESSAGE });
