import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import { UNTP_CORE_SCHEMA_FILENAMES, UNTP_SHORT_CREDENTIAL_TYPES } from '../../constants';
import { schemaCache } from './schemaValidation';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

const inflightFetches = new Map<string, Promise<any>>();

async function fetchSchema(schemaUrl: string): Promise<any> {
  if (schemaCache.has(schemaUrl)) {
    return schemaCache.get(schemaUrl);
  }
  const inflight = inflightFetches.get(schemaUrl);
  if (inflight) return inflight;

  const fetchPromise = (async () => {
    const response = await fetch(`/api/schema?url=${encodeURIComponent(schemaUrl)}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch schema at ${schemaUrl} (${response.status})`);
    }
    const schema = await response.json();
    schemaCache.set(schemaUrl, schema);
    return schema;
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
    if (!entry.includes('vocabulary/untp/cs/')) continue;
    const match = entry.match(/cs\/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)/);
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
