import { z } from 'zod';
import { libraryTagSchema } from '@/lib/library/library-tags';
import {
  DEFAULT_MAX_TAG_LENGTH,
  DEFAULT_MAX_TAGS_PER_RECORD,
  readMaxTagLength,
  readMaxTagsPerRecord,
} from '@/lib/api/library-tag-limits';

/**
 * A full list of tags as a request body carries it: on registration, on
 * single issuance, on each batch item and on the tags replacement. Each
 * element must match the tag grammar. The list may not name a tag twice and
 * is held to the deployment's count and length limits, read when the request
 * is admitted.
 *
 * The limits are a refinement rather than `.max()` bounds, so the published
 * component carries the grammar as each item's `pattern` but no `maxItems` or
 * `maxLength`: those would freeze the build-time defaults into a document a
 * reconfigured deployment serves. `superRefine` rather than `.pipe()` keeps
 * the component a plain array with no `allOf`. The description states the
 * defaults instead.
 *
 * Every message names the rule and never the submitted value. A duplicate
 * points back at the first occurrence by its full path, so a batch item's
 * reads `items.1.tags.3: must not repeat a tag; duplicates items.1.tags.1`
 * before the batch route rewrites the item index.
 */
export const libraryTagListSchema = z
  .array(libraryTagSchema, { required_error: 'is required', invalid_type_error: 'must be an array' })
  .superRefine((tags, ctx) => {
    const maxTags = readMaxTagsPerRecord();
    const maxLength = readMaxTagLength();
    if (tags.length > maxTags) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `must contain no more than ${maxTags} tags` });
    }
    const firstIndexOf = new Map<string, number>();
    tags.forEach((tag, index) => {
      if (tag.length > maxLength) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index],
          message: `must be no longer than ${maxLength} characters`,
        });
      }
      const firstIndex = firstIndexOf.get(tag);
      if (firstIndex === undefined) {
        firstIndexOf.set(tag, index);
        return;
      }
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: `must not repeat a tag; duplicates ${[...ctx.path, firstIndex].join('.')}`,
      });
    });
  })
  .describe(
    `Tags for the library record, in the order given. They label the record only and are never added to a credential. Each is lowercase letters and digits with single hyphens between them, and a tag may appear only once. By default a record holds up to ${DEFAULT_MAX_TAGS_PER_RECORD} tags of up to ${DEFAULT_MAX_TAG_LENGTH} characters each; a deployment can change both limits.`,
  );
