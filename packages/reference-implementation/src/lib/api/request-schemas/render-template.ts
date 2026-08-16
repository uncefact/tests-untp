import { z } from 'zod';

import { RenderMethodType } from '@/lib/prisma/generated';
import { idSchema, nonBlankString, paginationQuerySchema } from './shared';

/**
 * Storage service options for the render-template write routes. Previously
 * cast to `{ serviceInstanceId?: string }` without a check, so a mistyped
 * value (a string, an array, a number under `serviceInstanceId`) read as an
 * absent instance id and silently fell back to the tenant's default storage
 * service rather than failing.
 */
const storageOptionsSchema = z.object({
  serviceInstanceId: idSchema.optional().describe('Storage service instance ID'),
});

/**
 * A field the server owns, rejected when a client sends it at all.
 *
 * `z.undefined()` accepts only an absent (or explicitly undefined) value, so
 * any value at all produces this message against the field's own path, which
 * is what names the offending field in the 400.
 */
function serverManagedField(message: string) {
  return z.undefined({ invalid_type_error: message });
}

const REJECTED_SERVER_MANAGED_FIELDS = {
  storageUrl: serverManagedField('cannot be set directly'),
  digestMultibase: serverManagedField('cannot be set directly'),
  // The legacy field name is still rejected by name so callers built against
  // the pre-migration API surface get a clear error rather than a silent drop.
  hash: serverManagedField('is no longer accepted; use digestMultibase'),
};

/**
 * Request body for POST /render-templates.
 *
 * The server-managed fields come first in the shape so that a body which is
 * both malformed and carries one is reported against the field it must not
 * send, matching the order the hand-rolled checks applied.
 *
 * `mediaType` and `mediaQuery` stay `.nullable()`: the render-method
 * validator treats null and absent alike (`fields[f] != null`), and the
 * previous checks accepted an explicit null, so a client sending null keeps
 * getting the type's default rather than a new 400. `inline` and `isDefault`
 * reject null, as they did before.
 *
 * Only `name` takes `nonBlankString`, matching the label field of the
 * facility, organisation, registrar and scheme schemas. (`did.ts` keeps
 * `.min(1)` for its own `name`, so the precedent is strong rather than
 * universal.) The other text fields keep `.min(1)`, which is what the
 * previous `isNonEmptyString` checks enforced, so a whitespace-only value
 * that was accepted before is still accepted. Rejecting a blank `template`
 * would be a reasonable rule, but it is not this ticket's, and the obvious
 * rationale for it does not hold: `sanitiseTemplate('   ')` returns `'   '`
 * unchanged, so a blank template is stored verbatim rather than sanitised
 * away. A template that sanitises to nothing (`'<script>x</script>'` does)
 * is a separate policy about post-sanitisation content, and it needs its
 * own decision.
 */
export const createRenderTemplateRequestSchema = z.object({
  ...REJECTED_SERVER_MANAGED_FIELDS,
  name: nonBlankString.describe('Human-readable name for the render template'),
  dataModelId: idSchema.describe('ID of the data model this template renders'),
  renderMethodType: z.nativeEnum(RenderMethodType).describe('The W3C render method type'),
  template: z.string().min(1).describe('HTML content of the render template'),
  isDefault: z.boolean().optional().describe('Whether this is the default template for the data model'),
  inline: z.boolean().optional().describe('Whether the template is inline (RenderTemplate2024 only)'),
  mediaType: z.string().min(1).nullable().optional().describe('Media type for the render method'),
  mediaQuery: z.string().min(1).nullable().optional().describe('CSS media query for the render method'),
  storageOptions: storageOptionsSchema.optional().describe('Storage service options'),
});

/**
 * The fields a PATCH can actually change. This is every key of the update
 * schema except `storageOptions` and the rejected ones, and it has to be
 * maintained by hand, so a new updatable field added to the schema and the
 * handler without being added here would be rejected as "no updatable field"
 * when sent on its own.
 */
const UPDATABLE_FIELDS = ['name', 'template', 'isDefault', 'inline', 'mediaType', 'mediaQuery'] as const;

/**
 * Request body for PATCH /render-templates/{id}.
 *
 * `renderMethodType` joins the server-managed fields here because it is
 * immutable once the template exists: the stored render-method fields were
 * validated against it on create, and the update path has no way to
 * revalidate them.
 *
 * The at-least-one-field check is a superRefine rather than the shared
 * requireAtLeastOneField wrapper because `storageOptions` is a recognised
 * field that cannot be updated on its own: it only says where a replaced
 * template should be uploaded, so the wrapper, which counts every key of the
 * shape, would let a body carrying it alone through as a silent no-op 200.
 *
 * One update-side behaviour does change. `PATCH { "template": "" }` used to
 * return 200 having done nothing: the key was present so the at-least-one
 * check passed, but the empty string then failed the old
 * `isNonEmptyString(body.template)` guard, so no storage was resolved and
 * the orchestrator's `if (template && storageService)` skipped the upload.
 * `.min(1)` now rejects it. Keeping a silent no-op was not worth preserving.
 *
 * A refinement is skipped only when a field check aborts, which is what a
 * wrong type does, so a body carrying a rejected field reports that field
 * rather than the missing-update rule. A field that fails without aborting
 * (a `.min(1)` or a `.refine`) does let the refinement run, and both issues
 * are collected; the client still sees the field's own issue, because
 * parseRequestBody renders only the first.
 */
export const updateRenderTemplateRequestSchema = z
  .object({
    ...REJECTED_SERVER_MANAGED_FIELDS,
    renderMethodType: serverManagedField('cannot be set directly'),
    name: nonBlankString.optional().describe('Updated human-readable name for the render template'),
    template: z.string().min(1).optional().describe('HTML content to replace the existing template'),
    isDefault: z.boolean().optional().describe('Whether this is the default template for its data model'),
    inline: z.boolean().optional().describe('Whether to inline the template (RenderTemplate2024 only)'),
    mediaType: z.string().min(1).nullable().optional().describe('Media type of the template'),
    mediaQuery: z.string().min(1).nullable().optional().describe('CSS media query'),
    storageOptions: storageOptionsSchema
      .optional()
      .describe('Storage service options, read only when `template` is also provided'),
  })
  .superRefine((body, ctx) => {
    if (UPDATABLE_FIELDS.every((field) => body[field] === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `At least one updatable field must be provided: ${UPDATABLE_FIELDS.join(', ')}`,
      });
    }
  });

/**
 * Query parameters for GET /render-templates. `dataModelId` matches with an
 * exact-equality filter, so an empty value matches zero rows today; it is
 * left unconstrained per the ticket rather than tightened to idSchema.
 */
export const listRenderTemplatesQuerySchema = z
  .object({
    dataModelId: z.string().optional(),
  })
  .merge(paginationQuerySchema);
