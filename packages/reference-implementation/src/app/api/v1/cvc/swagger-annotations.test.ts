/**
 * @jest-environment node
 *
 * Runs under the node environment rather than the package default (jsdom):
 * under jsdom's browser export conditions the 'yaml' specifier resolves to
 * the package's ESM browser build, which the test transform does not process.
 */
import fs from 'fs';
import path from 'path';
import { parse } from 'yaml';
import { generateOpenAPISchemas } from '@/lib/swagger/schemas';

/**
 * next-swagger-doc's createSwaggerSpec globs the source tree at call time and
 * returns an empty document under jest, so the rendered spec cannot be
 * asserted here. These tests instead parse each CVC route's @swagger JSDoc
 * block directly and pin what the renderer would otherwise publish wrong
 * without failing: an operation on the wrong path, a tag matching no declared
 * tag, a response whose content block has gone missing, and a $ref to a
 * component the generator does not register.
 */

const DECLARED_TAG = 'Conformity Vocabulary Catalogue';
const ERROR_STATUSES = ['400', '401', '403', '500'];

const ROUTES = [
  { dir: 'schemes', route: '/cvc/schemes', component: 'ConformityScheme' },
  { dir: 'profiles', route: '/cvc/profiles', component: 'ConformityProfile' },
  { dir: 'criteria', route: '/cvc/criteria', component: 'ConformityCriterion' },
];

type Responses = Record<string, { content: { 'application/json': { schema: Record<string, never> } } }>;
type Operation = { tags: string[]; responses: Responses };

function operation(dir: string, route: string): Operation {
  const source = fs.readFileSync(path.join(__dirname, dir, 'route.ts'), 'utf8');
  const block = source.match(/\/\*\*\n \* @swagger\n([\s\S]*?)\*\//);
  if (!block) throw new Error(`no @swagger block in cvc/${dir}/route.ts`);
  const text = block[1]
    .split('\n')
    .map((line) => line.replace(/^ \*( |$)/, ''))
    .join('\n');
  const document = parse(text) as Record<string, { get?: Operation }>;
  const pathItem = document[route];
  if (!pathItem?.get) throw new Error(`cvc/${dir}/route.ts documents no GET on ${route}`);
  return pathItem.get;
}

function jsonSchema(op: Operation, status: string): Record<string, never> {
  return op.responses[status].content['application/json'].schema;
}

describe.each(ROUTES)('cvc/$dir @swagger annotation', ({ dir, route, component }) => {
  it('documents the GET under the declared tag', () => {
    expect(operation(dir, route).tags).toEqual([DECLARED_TAG]);
  });

  it('documents the 200 as a page of the entry component', () => {
    const schema = jsonSchema(operation(dir, route), '200') as unknown as {
      properties: { data: { items: { $ref: string } }; pagination: { $ref: string } };
    };

    expect(schema.properties.data.items.$ref).toBe(`#/components/schemas/${component}`);
    expect(schema.properties.pagination.$ref).toBe('#/components/schemas/PaginationMeta');
  });

  it.each(ERROR_STATUSES)('documents the %s with the error component', (status) => {
    const schema = jsonSchema(operation(dir, route), status) as unknown as { $ref: string };

    expect(schema.$ref).toBe('#/components/schemas/ErrorResponse');
  });

  it('references only components the generator registers', () => {
    const registered = generateOpenAPISchemas();
    const refs = [...JSON.stringify(operation(dir, route)).matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);

    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(registered[ref]).toBeDefined();
    }
  });
});

describe('swagger.ts tag declarations', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../../lib/swagger/swagger.ts'), 'utf8');
  const declared = [...source.matchAll(/name: '([^']+)',\n\s*description:/g)].map((m) => m[1]);

  it('declares the catalogue tag exactly once', () => {
    expect(declared.filter((name) => name === DECLARED_TAG)).toEqual([DECLARED_TAG]);
  });

  it('no longer declares the superseded CVC tag', () => {
    expect(declared).not.toContain('CVC');
  });
});
