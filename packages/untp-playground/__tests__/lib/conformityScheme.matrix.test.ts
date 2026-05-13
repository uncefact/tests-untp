/**
 * Matrix tests for ConformityScheme validation across spec versions.
 *
 * Each entry in `CONFORMITY_SCHEME_VERSIONS` produces:
 *   - a canonical-instance test (the published sample must pass every step)
 *   - one test per invalid case, asserting failure at the expected step
 *
 * Adding a new spec version is purely additive: extend the registry. See
 * `__tests__/fixtures/conformity-schemes/registry.ts` for the contract.
 */

import { validateContext } from '@/lib/contextValidation';
import { detectSchemeVersion, validateSchemeSchema } from '@/lib/schemeValidation';
import { schemaCache } from '@/lib/schemaValidation';
import { CONFORMITY_SCHEME_VERSIONS } from '../fixtures/conformity-schemes/registry';

const originalFetch = global.fetch;

describe.each(CONFORMITY_SCHEME_VERSIONS)(
  'ConformityScheme v$version',
  ({ version, schemaUrl, schema, validSample, invalidCases }) => {
    beforeEach(() => {
      // Mock the /api/schema proxy so AJV compiles against the baked fixture
      // instead of fetching the published schema over the network.
      schemaCache.delete(schemaUrl);
      global.fetch = jest.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.startsWith('/api/schema')) {
          return {
            ok: true,
            status: 200,
            json: async () => schema,
          } as unknown as Response;
        }
        throw new Error(`Unexpected fetch in test: ${url}`);
      }) as jest.Mock;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      schemaCache.delete(schemaUrl);
    });

    it('detects the version from the canonical sample', () => {
      expect(detectSchemeVersion(validSample)).toBe(version);
    });

    it('passes schema validation against the canonical sample', async () => {
      const result = await validateSchemeSchema(validSample, version);
      expect(result.valid).toBe(true);
    });

    describe('invalid cases', () => {
      it.each(invalidCases)('rejects: $name (fails at $failsAt)', async ({ mutate, failsAt, expectedKeyword }) => {
        const malformed = mutate(JSON.parse(JSON.stringify(validSample)));

        if (failsAt === 'version') {
          expect(detectSchemeVersion(malformed)).toBeNull();
          return;
        }

        if (failsAt === 'schema') {
          const result = await validateSchemeSchema(malformed, version);
          expect(result.valid).toBe(false);
          expect(result.errors && result.errors.length).toBeGreaterThan(0);
          if (expectedKeyword) {
            expect(result.errors?.some((e: { keyword?: string }) => e.keyword === expectedKeyword)).toBe(true);
          }
          return;
        }

        // failsAt === 'context': run JSON-LD expansion and assert it errors.
        // Skip schema/version assertions because context failures often pass
        // those gates first.
        const contextResult = await validateContext(malformed);
        expect(contextResult.valid).toBe(false);
        expect(contextResult.error).toBeDefined();
      });
    });
  },
);
