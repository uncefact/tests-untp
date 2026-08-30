import { requestBodyTooLargeMessage } from '@/lib/api/request-body';
import { readMaxRequestBodyBytes } from '@/lib/config/request-body-limit.config';

/**
 * Example error bodies for the published OpenAPI document.
 *
 * Swagger UI fills a response's example pane from the examples the document
 * attaches. With none, it prints each property's type name instead, which is
 * why every error response on the docs page reads `{"error": "string", "code":
 * "string"}`. That placeholder also implies a `code` on responses that never
 * carry one: the route error mapper attaches `code` only for validation errors
 * constructed with one and for service-layer errors, so a forbidden,
 * not-found, conflict or unprocessable body is `error` alone.
 *
 * Every string below is a literal the code actually produces, quoted from its
 * source rather than composed here. Message text is easy to get wrong from
 * memory: zod's enum message quotes each member and joins with `" | "`, and
 * the unmapped 500 carries a correlation-id sentence that is easy to omit.
 * When adding an example, copy the literal from the code that emits it.
 *
 * Two sources feed the examples. `SHARED_STATUS_EXAMPLES` covers the statuses
 * whose body is the same on every route. A 404 or 409 instead takes its
 * example from its own documented description, but only where that
 * description is exactly a message the code throws, so the example is a
 * quotation rather than a composition. A response documenting several causes
 * matches nothing and is left bare, because publishing one of its causes would
 * state the wrong message for the others. The sibling test pins the bare set
 * exactly, in both directions, so coverage can neither regress nor be widened
 * by a guess.
 */

/** A JSON error body as the route error mapper serialises it. */
export type ErrorExample = { summary: string; value: { error: string; code?: string } };

/**
 * The 401 bodies `withTenantAuth` returns before a handler runs. Quoted from
 * the returns in `src/lib/api/with-tenant-auth.ts`.
 */
export const UNAUTHORISED_EXAMPLES: Record<string, ErrorExample> = {
  missingOrInvalidCredentials: {
    summary: 'No session or bearer token resolved',
    value: { error: 'Unauthorised' },
  },
  sessionExpired: {
    summary: 'The interactive session could not be refreshed, so the caller signs in again',
    value: { error: 'Session expired. Please sign in again' },
  },
  tokenMissingSub: {
    summary: 'A bearer token passed validation but carries no subject claim',
    value: { error: 'Token missing required sub claim' },
  },
};

/**
 * The 403 bodies `withTenantAuth` returns when a caller authenticates but no
 * tenant can be resolved for them. Quoted from the same file.
 */
export const TENANT_FORBIDDEN_EXAMPLES: Record<string, ErrorExample> = {
  noTenantForUser: {
    summary: 'The authenticated user maps to no tenant',
    value: { error: 'No tenant found for user' },
  },
  noGroupAssignment: {
    summary: 'The identity provider returned no group assignment',
    value: { error: 'No group assignment found' },
  },
  noTenantForGroup: {
    summary: "The caller's group maps to no tenant",
    value: { error: 'No tenant found for group' },
  },
};

/**
 * The 413 body `readRequestBytes` throws when the request exceeds
 * `MAX_REQUEST_BODY_BYTES`. Quoted from `src/lib/api/request-body.ts`. The
 * example uses the default cap so the published document does not follow
 * whichever value the process that generated it happened to have set.
 */
export const PAYLOAD_TOO_LARGE_EXAMPLES: Record<string, ErrorExample> = {
  bodyTooLarge: {
    summary: 'The request body exceeds the configured maximum',
    value: {
      error: requestBodyTooLargeMessage(readMaxRequestBodyBytes({})),
      code: 'REQUEST_BODY_TOO_LARGE',
    },
  },
};

export const PAYLOAD_TOO_LARGE_RESPONSE_REF = '#/components/responses/PayloadTooLargeResponse';

/**
 * Bodies whose shape is identical on every route that documents the status.
 *
 * 400: `parseRequestBody` and `parseQueryParams` render the first failure as
 * `field: message`, and a body that is not JSON at all short-circuits to a
 * fixed sentence. Both are in `src/lib/api/validation.ts`.
 *
 * 500: `unexpectedErrorMessage` in `src/lib/api/errors.ts` appends the
 * correlation id whenever a request context exists, which `withTenantAuth`
 * establishes for every request, so the suffixed form is what callers see.
 */
export const SHARED_STATUS_EXAMPLES: Record<string, Record<string, ErrorExample>> = {
  '400': {
    fieldValidationFailure: {
      summary: 'A field failed validation; the message names it',
      value: { error: 'limit: must be a positive integer' },
    },
    malformedJsonBody: {
      summary: 'The request body did not parse as JSON',
      value: { error: 'Invalid JSON body' },
    },
  },
  '500': {
    unexpectedFailure: {
      summary: 'An unhandled failure, with the id that ties the request to its server-side logs',
      value: {
        error:
          'An unexpected error has occurred. If the issue persists, please contact support and quote correlation id "01JD8Z2Q6R7K3M4N5P6Q7R8S9T".',
      },
    },
  },
};

/**
 * Messages the routes and repositories actually throw for a 404, a 409, or a 422.
 *
 * Where an operation's documented description is exactly one of these, the
 * description is quoting the thrown message, so it can be published as that
 * response's example without composing anything. A description that says
 * something else, usually because the operation has several causes, matches
 * nothing here and is left without an example rather than given a plausible
 * one, which is the whole point: a wrong example is worse than none, because
 * an integrator writes code against it.
 *
 * To refresh, collect the `new NotFoundError('...')`,
 * `new ConflictError('...')`, and `new UnprocessableError('...')`
 * arguments under `src/app/api/v1`, plus the `notFound`, `conflict` and
 * `invalidReference` values handed to `mapDatabaseError` in the
 * repositories.
 */
export const VERIFIED_ERROR_MESSAGES = new Set([
  'A DID record with this DID already exists',
  'A data model with this name already exists for the credential type and version',
  'A qualifier with this key already exists for the scheme',
  'An identifier in this request is already the primary identifier of another facility',
  'An identifier in this request is already the primary identifier of another organisation',
  'An identifier in this request is already the primary identifier of another product',
  'An identifier scheme with this primary key already exists for the registrar',
  'An identifier with this value already exists for the scheme',
  'A request with this Idempotency-Key is still being processed. Retry shortly.',
  "Another request now holds this Idempotency-Key. Retry to receive that request's result.",
  'Credential not found',
  'DID not found',
  'Data model not found',
  'Facility not found',
  'Identifier not found',
  'Identifier scheme not found',
  'Link registration not found',
  'Organisation not found',
  'Parent data model configuration not found',
  'Product not found',
  'Registrar not found',
  'Render template not found',
  'The identifier is already the primary identifier of another facility',
  'The identifier is already the primary identifier of another organisation',
  'The identifier is already the primary identifier of another product',
  'The identifier scheme has identifiers and cannot be deleted',
  'The registrar has schemes with identifiers and cannot be deleted',
  'This Idempotency-Key was already used with a different request body.',
]);

/**
 * Verified messages that must not be matched automatically, because more than
 * one distinct body carries the same wording.
 *
 * `ServiceInstanceNotFoundError` appends the requested id
 * (`Service instance not found: si-123`) while the service routes throw the
 * bare `NotFoundError('Service instance not found')`. An operation documenting
 * "Service instance not found" may mean either, so publishing one form would
 * state the wrong body for the routes that emit the other.
 */
const AMBIGUOUS_ERROR_MESSAGES = new Set(['Service instance not found']);

type MediaType = { schema?: unknown; examples?: Record<string, ErrorExample> };
type ResponseObject = { $ref?: string; description?: string; content?: Record<string, MediaType> };
type Operation = { requestBody?: unknown; responses?: Record<string, ResponseObject> };

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];

/**
 * Attaches the shared 413 to every operation that declares a request body
 * and does not already document that status. Auth 401/403 are referenced
 * from each JSDoc block because they apply to the wrapper, not the body.
 * The size cap applies to every body the API accepts, so the reference is
 * added here rather than copied into each write-route block.
 */
export function attachPayloadTooLargeResponses(spec: Record<string, unknown>): void {
  const paths = spec.paths as Record<string, Record<string, Operation>> | undefined;
  if (!paths) return;

  for (const pathItem of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method];
      if (!operation?.requestBody) continue;
      if (!operation.responses) operation.responses = {};
      if (operation.responses['413'] !== undefined) continue;
      operation.responses['413'] = { $ref: PAYLOAD_TOO_LARGE_RESPONSE_REF };
    }
  }
}

/**
 * The example for a response whose description quotes the message the code
 * throws, or undefined when it quotes nothing verifiable.
 */
function quotedMessageExample(description: string | undefined): Record<string, ErrorExample> | undefined {
  const message = description?.trim();
  if (!message || !VERIFIED_ERROR_MESSAGES.has(message) || AMBIGUOUS_ERROR_MESSAGES.has(message)) {
    return undefined;
  }
  return { ['default']: { summary: message, value: { error: message } } };
}

/**
 * Attaches the shared examples to every operation response that declares its
 * own content and has none.
 *
 * Responses that are a `$ref` to a shared response component are skipped: in
 * OpenAPI 3.0 a Reference Object cannot be extended, and any sibling property
 * added beside `$ref` is ignored, so those are covered by putting the examples
 * on the components themselves. Where the response is declared inline and only
 * its `schema` is a `$ref`, `examples` is a sibling of `schema` rather than of
 * `$ref`, so it attaches normally.
 */
export function attachErrorExamples(spec: Record<string, unknown>): void {
  const paths = spec.paths as Record<string, Record<string, Operation>> | undefined;
  if (!paths) return;

  for (const pathItem of Object.values(paths)) {
    for (const method of HTTP_METHODS) {
      const responses = pathItem[method]?.responses;
      if (!responses) continue;

      for (const [status, response] of Object.entries(responses)) {
        if (response.$ref !== undefined) continue;

        const mediaType = response.content?.['application/json'];
        if (!mediaType || mediaType.examples !== undefined) continue;

        const shared = SHARED_STATUS_EXAMPLES[status];
        if (shared) {
          mediaType.examples = shared;
          continue;
        }

        const quoted = quotedMessageExample(response.description);
        if (quoted) mediaType.examples = quoted;
      }
    }
  }
}
