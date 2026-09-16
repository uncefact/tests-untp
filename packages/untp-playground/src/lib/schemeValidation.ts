import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import { buildUntpArtefactUrls, isV070OrAbove } from '@uncefact/untp-utils/artefacts';
import { fetchSchema, SchemaFetchError, SchemaSelectionError } from './schemaFetch';

// SchemaSelectionError is the only shared binding: both result components narrow on its identity. The
// scheme validator re-exports its SchemaFetchError binding from schemaFetch.ts, while
// schemaValidation.ts defines its own SchemaFetchError.
export { SchemaFetchError, SchemaSelectionError };

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

export async function validateSchemeSchema(
  scheme: Record<string, unknown>,
  version: string,
): Promise<{ valid: boolean; errors?: any[]; schemaUrl: string }> {
  if (!isV070OrAbove(version)) {
    throw new SchemaSelectionError(
      `Conformity Scheme schemas have no legacy layout before UNTP 0.7.0; detected ${version}.`,
    );
  }

  const schemaUrl = buildUntpArtefactUrls('ConformityScheme', version).schemaUrl;
  const schema = await fetchSchema(schemaUrl);
  const validate = ajv.compile(schema);
  const valid = validate(scheme);
  return { valid, errors: valid ? undefined : validate.errors ?? [], schemaUrl };
}
