/**
 * Guards the example bodies on the published error responses.
 *
 * Without examples, Swagger UI prints each property's type name, so every
 * error response reads `{"error": "string", "code": "string"}`. That is both
 * uninformative and wrong about `code`, which most error bodies omit. These
 * tests pin the statuses that are covered, so a new route cannot reintroduce
 * the placeholder on them, and record which statuses are still bare.
 */

import { getApiDocs } from './swagger';
import { PAYLOAD_TOO_LARGE_RESPONSE_REF, SHARED_STATUS_EXAMPLES, VERIFIED_ERROR_MESSAGES } from './error-examples';

type MediaType = { schema?: { $ref?: string }; examples?: Record<string, { summary: string; value: unknown }> };
type ResponseObject = { $ref?: string; description?: string; content?: Record<string, MediaType> };
type Spec = {
  paths?: Record<string, Record<string, { requestBody?: unknown; responses?: Record<string, ResponseObject> }>>;
  components?: { responses?: Record<string, ResponseObject> };
};

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

/** Every (operation, status, response) triple for a 4xx or 5xx in the document. */
function errorResponses(spec: Spec): Array<{ id: string; status: string; response: ResponseObject }> {
  const found: Array<{ id: string; status: string; response: ResponseObject }> = [];
  for (const [route, pathItem] of Object.entries(spec.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      const responses = pathItem[method]?.responses;
      if (!responses) continue;
      for (const [status, response] of Object.entries(responses)) {
        if (/^[45]/.test(status)) found.push({ id: `${method} ${route}`, status, response });
      }
    }
  }
  return found;
}

describe('published error response examples', () => {
  let spec: Spec;

  beforeAll(async () => {
    spec = (await getApiDocs()) as Spec;
  });

  it('finds error responses to check, so a broken walk cannot pass vacuously', () => {
    expect(errorResponses(spec).length).toBeGreaterThan(100);
  });

  it.each([
    ['UnauthorisedResponse', 'Unauthorised'],
    ['TenantAssignmentForbiddenResponse', 'No tenant found for user'],
  ])('gives %s examples carrying the wording the wrapper actually returns', (name, expectedMessage) => {
    const examples = spec.components?.responses?.[name]?.content?.['application/json']?.examples;
    expect(examples).toBeDefined();

    const messages = Object.values(examples!).map((e) => (e.value as { error: string }).error);
    expect(messages).toContain(expectedMessage);
    // None of these bodies carries a code: the wrapper returns them directly
    // rather than through the error mapper's coded branches.
    for (const example of Object.values(examples!)) {
      expect(example.value).not.toHaveProperty('code');
    }
  });

  it('gives PayloadTooLargeResponse the 413 body the reader actually throws', () => {
    const examples = spec.components?.responses?.PayloadTooLargeResponse?.content?.['application/json']?.examples;
    expect(examples).toBeDefined();

    const values = Object.values(examples!).map((e) => e.value as { error: string; code?: string });
    expect(values).toContainEqual({
      error: 'The request body exceeds the maximum of 5242880 bytes.',
      code: 'REQUEST_BODY_TOO_LARGE',
    });
  });

  it('documents 413 on every operation that accepts a request body, by reference', () => {
    const operationsWithBody = Object.entries(spec.paths ?? {}).flatMap(([route, pathItem]) =>
      HTTP_METHODS.flatMap((method) => {
        const operation = pathItem[method];
        if (!operation?.requestBody) return [];
        return [`${method} ${route}`];
      }),
    );

    const without413 = operationsWithBody.filter((id) => {
      const [method, ...routeParts] = id.split(' ');
      const route = routeParts.join(' ');
      return spec.paths?.[route]?.[method]?.responses?.['413']?.$ref !== PAYLOAD_TOO_LARGE_RESPONSE_REF;
    });

    expect(operationsWithBody.length).toBeGreaterThan(0);
    expect(without413).toEqual([]);
  });

  it('does not advertise 413 on an operation with no request body', () => {
    const advertised = errorResponses(spec)
      .filter((r) => r.status === '413')
      .filter((r) => {
        const [method, ...routeParts] = r.id.split(' ');
        const route = routeParts.join(' ');
        return spec.paths?.[route]?.[method]?.requestBody === undefined;
      })
      .map((r) => `${r.id} 413`);

    expect(advertised).toEqual([]);
  });

  it.each(Object.keys(SHARED_STATUS_EXAMPLES))(
    'gives every documented %s an example, so none renders as a type-name placeholder',
    (status) => {
      const bare = errorResponses(spec)
        .filter((r) => r.status === status && r.response.$ref === undefined)
        .filter((r) => r.response.content?.['application/json']?.examples === undefined)
        .map((r) => `${r.id} ${r.status}`);

      expect(bare).toEqual([]);
    },
  );

  it('attaches examples to responses whose schema is a $ref, where a sibling key is legal', () => {
    const decorated = errorResponses(spec).filter(
      (r) =>
        r.response.content?.['application/json']?.schema?.$ref?.endsWith('/ErrorResponse') &&
        r.response.content?.['application/json']?.examples !== undefined,
    );

    expect(decorated.length).toBeGreaterThan(0);
  });

  it('never adds a sibling key to a response that is itself a $ref, which OpenAPI 3.0 ignores', () => {
    const violations = errorResponses(spec)
      .filter((r) => r.response.$ref !== undefined)
      .filter((r) => Object.keys(r.response).length > 1)
      .map((r) => `${r.id} ${r.status}`);

    expect(violations).toEqual([]);
  });

  // Not an aspiration, a record. Every response below documents more than one
  // cause, so no single body is the example: a multi-cause 404 that published
  // one of its causes would state the wrong message for the others. Covering
  // them needs a per-cause source of truth.
  //
  // Pinned exactly, in both directions. Coverage cannot regress without this
  // failing, and it cannot be widened by publishing a guess without this
  // failing either.
  it('records exactly which responses still have no example', () => {
    const bare = errorResponses(spec)
      .filter((r) => r.response.$ref === undefined)
      .filter((r) => r.response.content?.['application/json']?.examples === undefined)
      .map((r) => `${r.id} ${r.status}`)
      .sort();

    expect(bare).toEqual([
      'delete /identifiers/{id}/links/{linkId} 404',
      'delete /services/{id} 404',
      'delete /services/{id} 409',
      'get /dids/{id}/document 404',
      'get /dids/{id}/document 502',
      'get /identifiers/{id}/links/{linkId} 404',
      'get /services/{id} 404',
      'patch /facilities/{id} 404',
      'patch /facilities/{id} 409',
      'patch /identifiers/{id}/links/{linkId} 404',
      'patch /identifiers/{id}/links/{linkId} 409',
      'patch /organisations/{id} 404',
      'patch /organisations/{id} 409',
      'patch /products/{id} 409',
      'patch /registrars/{id} 404',
      'patch /render-templates/{id} 404',
      'patch /schemes/{id} 404',
      'patch /schemes/{id} 409',
      'patch /services/{id} 404',
      'post /credentials 404',
      'post /credentials/verify 422',
      'post /credentials/verify 502',
      'post /dids 404',
      'post /dids 409',
      'post /dids 502',
      'post /dids/import 404',
      'post /dids/{id}/verify 404',
      'post /facilities 404',
      'post /identifiers 404',
      'post /organisations 404',
      'post /products 404',
      'post /registrars 404',
      'post /render-templates 404',
      'post /schemes 404',
    ]);
  });

  it('publishes only messages the code actually throws', () => {
    // Every quoted-message example must be a message the code throws, which is
    // what makes it a quotation rather than a composition. A response with one
    // cause quotes its own description; a response with several (a status a
    // route reaches by more than one route, such as an Idempotency-Key that is
    // in flight or held elsewhere) quotes one of the verified messages, since
    // no single description can be all of them verbatim.
    const quoted = errorResponses(spec).filter((r) => ['404', '409'].includes(r.status));

    for (const { id, status, response } of quoted) {
      const examples = response.content?.['application/json']?.examples;
      if (!examples) continue;
      for (const example of Object.values(examples)) {
        const message = (example.value as { error: string }).error;
        const isDescription = message === response.description?.trim();
        expect(`${id} ${status} ${isDescription || VERIFIED_ERROR_MESSAGES.has(message)}`).toBe(`${id} ${status} true`);
      }
    }
  });
});
