import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import { UNTP_CONTEXT_DOMAINS, UNTP_CORE_SCHEMA_FILENAMES, UNTP_SHORT_CREDENTIAL_TYPES } from '../../constants';
import { fetchSchema, SchemaFetchError } from './schemaFetch';

// Re-exported as the same binding: SchemeTestResults narrows on `instanceof SchemaFetchError`
// through this module, and the transport moved to schemaFetch.ts without changing that contract.
export { SchemaFetchError };

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

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
