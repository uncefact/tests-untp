import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import { UNTP_CONTEXT_DOMAINS, UNTP_CORE_SCHEMA_FILENAMES, UNTP_SHORT_CREDENTIAL_TYPES } from '../../constants';
import { schemaCache } from './schemaValidation';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

const SCHEMA_FETCH_TIMEOUT_MS = 15_000;

const inflightFetches = new Map<string, Promise<any>>();

export class SchemaFetchError extends Error {
  constructor(
    public readonly schemaUrl: string,
    public readonly reason: 'timeout' | 'not-found' | 'network' | 'parse',
    message: string,
  ) {
    super(message);
    this.name = 'SchemaFetchError';
  }
}

async function fetchSchema(schemaUrl: string): Promise<any> {
  if (schemaCache.has(schemaUrl)) {
    return schemaCache.get(schemaUrl);
  }
  const inflight = inflightFetches.get(schemaUrl);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCHEMA_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/schema?url=${encodeURIComponent(schemaUrl)}`, {
        signal: controller.signal,
      });
      if (response.status === 404) {
        throw new SchemaFetchError(schemaUrl, 'not-found', `No schema published at ${schemaUrl}.`);
      }
      if (!response.ok) {
        throw new SchemaFetchError(
          schemaUrl,
          'network',
          `Schema service returned ${response.status} for ${schemaUrl}.`,
        );
      }
      let schema: unknown;
      try {
        schema = await response.json();
      } catch {
        throw new SchemaFetchError(schemaUrl, 'parse', `Schema at ${schemaUrl} is not valid JSON.`);
      }
      schemaCache.set(schemaUrl, schema);
      return schema;
    } catch (err) {
      if (err instanceof SchemaFetchError) throw err;
      if (err instanceof Error && err.name === 'AbortError') {
        throw new SchemaFetchError(
          schemaUrl,
          'timeout',
          `Schema fetch timed out after ${SCHEMA_FETCH_TIMEOUT_MS / 1000}s.`,
        );
      }
      throw new SchemaFetchError(schemaUrl, 'network', err instanceof Error ? err.message : 'Unknown network error.');
    } finally {
      clearTimeout(timeout);
    }
  })();

  inflightFetches.set(schemaUrl, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inflightFetches.delete(schemaUrl);
  }
}

export function schemeSchemaUrl(version: string): string {
  const shortType = UNTP_SHORT_CREDENTIAL_TYPES.ConformityScheme;
  const fileName = UNTP_CORE_SCHEMA_FILENAMES.ConformityScheme;
  return `https://untp.unece.org/artefacts/schema/v${version}/${shortType}/${fileName}.json`;
}

export function detectSchemeVersion(scheme: Record<string, unknown>): string | null {
  const contexts = scheme['@context'];
  if (!Array.isArray(contexts)) return null;
  for (const entry of contexts) {
    if (typeof entry !== 'string') continue;
    if (!UNTP_CONTEXT_DOMAINS.some((domain) => entry.includes(domain))) continue;
    const match = entry.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)/);
    if (match) return match[1];
  }
  return null;
}

export async function validateSchemeSchema(
  scheme: Record<string, unknown>,
  version: string,
): Promise<{ valid: boolean; errors?: any[]; schemaUrl: string }> {
  const schemaUrl = schemeSchemaUrl(version);
  const schema = await fetchSchema(schemaUrl);
  const validate = ajv.compile(schema);
  const valid = validate(scheme);
  return { valid, errors: valid ? undefined : validate.errors ?? [], schemaUrl };
}
