/**
 * Congruence checks for the shared auth responses (#852).
 *
 * `withTenantAuth` answers 401 when a caller is unauthenticated and 403 when
 * an authenticated principal has no resolvable tenant, so every operation it
 * wraps owes the reader both. Hand-written blocks had already drifted into
 * four wordings, so these tests guard the referenced form rather than the
 * prose: an operation that documents its own auth block, or omits one, fails
 * here rather than reaching the published specification.
 */
import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { getApiDocs } from './swagger';

const UNAUTHORISED_REF = '#/components/responses/UnauthorisedResponse';
const FORBIDDEN_REF = '#/components/responses/TenantAssignmentForbiddenResponse';

/**
 * `POST /dids` documents a combined 403: the tenant-assignment case shared
 * with every route, plus a business rule the handler itself enforces
 * (a tenant may not claim the system VC service's root DID). Referencing the
 * shared component alone would delete half of that contract, so this
 * operation keeps an inline response and is checked for both causes instead.
 */
const COMBINED_FORBIDDEN_OPERATIONS = new Set(['post /dids']);

// This exemption can only go stale in the safe direction: an entry for a route
// that changed simply stops matching. Nothing detects that an operation has
// become (or stopped being) exceptional, so revisit it when the DID routes
// change what they enforce.

type Response = {
  $ref?: string;
  description?: string;
  content?: Record<string, { schema?: { $ref?: string } }>;
};
type Operation = { responses?: Record<string, Response> };
type Spec = {
  paths?: Record<string, Record<string, Operation>>;
  components?: { responses?: Record<string, unknown>; schemas?: Record<string, unknown> };
};

/**
 * Which wrapper guards each exported handler, read from source rather than
 * inferred from the specification: the generated document records what an
 * operation says, not what enforces it, and that gap is exactly what lets an
 * operation advertise auth it does not apply.
 *
 * Keyed by operation rather than by file, because one route file can export a
 * guarded POST beside a public GET; a file-level answer would call both
 * guarded and wave the public one through.
 */
export type HandlerExport = { route: string; method: string; wrapper: string };

const HANDLER_EXPORT = /^export const (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*([A-Za-z_][\w]*)\s*\(/gm;

export function exportedHandlers(): HandlerExport[] {
  const apiRoot = path.join(process.cwd(), 'src/app/api/v1');
  const handlers: HandlerExport[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (entry.name !== 'route.ts') continue;

      // src/app/api/v1/schemes/[id]/route.ts -> /schemes/{id}
      const relative = path.relative(apiRoot, path.dirname(full));
      const route = relative === '' ? '/' : '/' + relative.replace(/\[([^\]]+)\]/g, '{$1}');

      for (const [, method, wrapper] of readFileSync(full, 'utf8').matchAll(HANDLER_EXPORT)) {
        handlers.push({ route, method: method.toLowerCase(), wrapper });
      }
    }
  };

  walk(apiRoot);
  return handlers;
}

/** Walks every $ref in the document, whatever its depth, and resolves it. */
function unresolvedReferences(spec: Spec): string[] {
  const components = (spec.components ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const unresolved: string[] = [];

  const visit = (node: unknown, where: string) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${where}[${index}]`));
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === '$ref' && typeof value === 'string') {
        const match = /^#\/components\/([^/]+)\/(.+)$/.exec(value);
        if (match === null || components[match[1]]?.[match[2]] === undefined) {
          unresolved.push(`${where} -> ${value}`);
        }
        continue;
      }
      visit(value, `${where}.${key}`);
    }
  };

  visit(spec.paths, 'paths');
  visit(spec.components, 'components');
  return unresolved;
}

describe('shared auth responses', () => {
  let spec: Spec;

  beforeAll(async () => {
    spec = (await getApiDocs()) as Spec;
  });

  it('declares both auth response components', () => {
    expect(spec.components?.responses).toHaveProperty('UnauthorisedResponse');
    expect(spec.components?.responses).toHaveProperty('TenantAssignmentForbiddenResponse');
  });

  it.each([
    ['UnauthorisedResponse', 'Unauthorised - missing or invalid authentication'],
    ['TenantAssignmentForbiddenResponse', 'Forbidden - authenticated principal has no resolvable tenant assignment'],
  ])('states exactly what %s means, since every route now inherits that wording', (name, expected) => {
    const response = spec.components?.responses?.[name] as { description?: string } | undefined;

    // Exact, not contained: the drift this sweep removed included an American
    // spelling and an em-dash variant, both of which contain the fragment.
    expect(response?.description).toBe(expected);
  });

  it.each(['UnauthorisedResponse', 'TenantAssignmentForbiddenResponse'])(
    'resolves the schema %s carries, so the body shape is not a dangling reference',
    (name) => {
      const response = spec.components?.responses?.[name] as
        | { content?: Record<string, { schema?: { $ref?: string } }> }
        | undefined;
      const ref = response?.content?.['application/json']?.schema?.$ref;

      expect(ref).toBe('#/components/schemas/ErrorResponse');
      expect(spec.components?.schemas).toHaveProperty('ErrorResponse');
    },
  );

  it('resolves every reference in the document, at any depth', () => {
    expect(unresolvedReferences(spec)).toEqual([]);
  });

  it('documents exactly the operations the routes export', () => {
    const documented = new Set<string>();
    for (const [route, operations] of Object.entries(spec.paths ?? {})) {
      for (const method of Object.keys(operations)) documented.add(`${method} ${route}`);
    }
    const exported = new Set(exportedHandlers().map((h) => `${h.method} ${h.route}`));

    // A handler with no annotation is invisible to consumers; an annotation
    // with no handler promises an endpoint that does not answer. Neither can
    // be caught by walking only the specification, which is why the census is
    // compared in both directions.
    expect({
      undocumented: [...exported].filter((id) => !documented.has(id)).sort(),
      unimplemented: [...documented].filter((id) => !exported.has(id)).sort(),
    }).toEqual({ undocumented: [], unimplemented: [] });
  });

  it('documents both auth responses on every guarded operation, by reference', () => {
    const guarded = exportedHandlers().filter((h) => h.wrapper === 'withTenantAuth');
    expect(guarded.length).toBeGreaterThan(0);

    const missing: string[] = [];
    const inlined: string[] = [];

    for (const { route, method } of guarded) {
      const id = `${method} ${route}`;
      const responses = spec.paths?.[route]?.[method]?.responses;

      const unauthorised = responses?.['401'];
      if (unauthorised?.$ref !== UNAUTHORISED_REF) {
        (unauthorised === undefined ? missing : inlined).push(`${id} 401`);
      }

      const forbidden = responses?.['403'];
      if (COMBINED_FORBIDDEN_OPERATIONS.has(id)) {
        // Both causes must survive: the shared wording plus its own rule.
        expect(forbidden?.description).toContain('no resolvable tenant assignment');
        expect(forbidden?.description).toContain('root DID');
        // Staying inline costs this operation the component's body shape, so
        // the schema it carries is asserted here instead.
        expect(forbidden?.content?.['application/json']?.schema?.$ref).toBe('#/components/schemas/ErrorResponse');
        continue;
      }
      if (forbidden?.$ref !== FORBIDDEN_REF) {
        (forbidden === undefined ? missing : inlined).push(`${id} 403`);
      }
    }

    expect({ missing, inlined }).toEqual({ missing: [], inlined: [] });
  });

  it('never advertises auth responses on an operation no auth wrapper guards', () => {
    const ungated = exportedHandlers().filter((h) => h.wrapper !== 'withTenantAuth');
    expect(ungated.length).toBeGreaterThan(0);

    const falselyAdvertised = ungated
      .filter(({ route, method }) => {
        const responses = spec.paths?.[route]?.[method]?.responses;
        return [responses?.['401']?.$ref, responses?.['403']?.$ref].some(
          (ref) => ref === UNAUTHORISED_REF || ref === FORBIDDEN_REF,
        );
      })
      .map(({ route, method }) => `${method} ${route}`);

    expect(falselyAdvertised).toEqual([]);
  });

  it("reads each handler's own wrapper, including nested dynamic segments", () => {
    const handlers = exportedHandlers();
    const wrapperFor = (id: string) => handlers.find((h) => `${h.method} ${h.route}` === id)?.wrapper;

    // Pins the source-to-specification mapping independently of spec content,
    // so a discovery bug surfaces as itself rather than as a coverage failure.
    expect(wrapperFor('get /dids/{id}')).toBe('withTenantAuth');
    expect(wrapperFor('delete /identifiers/{id}/links/{linkId}')).toBe('withTenantAuth');
    expect(wrapperFor('post /credentials/verify')).toBe('withPublicRoute');
  });

  it('leaves the public verification operation without auth responses', () => {
    const verify = spec.paths?.['/credentials/verify']?.post;

    expect(verify).toBeDefined();
    expect(verify?.responses?.['401']).toBeUndefined();
    expect(verify?.responses?.['403']).toBeUndefined();
  });
});
