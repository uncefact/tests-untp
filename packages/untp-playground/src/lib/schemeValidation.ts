import { buildUntpArtefactUrls, isV070OrAbove } from '@uncefact/untp-utils/artefacts';
import type { ArtefactStepFailure } from './artefactFailure';
import { fetchSchema, SchemaFetchError, SchemaSelectionError } from './schemaFetch';
import { validateSchemaDocument } from './schemaValidation';

export { SchemaFetchError, SchemaSelectionError };

export interface SchemeSchemaValidationResult {
  valid: boolean;
  errors?: any[];
  schemaUrl: string;
  failure?: ArtefactStepFailure;
}

export async function validateSchemeSchema(
  scheme: Record<string, unknown>,
  version: string,
): Promise<SchemeSchemaValidationResult> {
  if (!isV070OrAbove(version)) {
    const error = new SchemaSelectionError(
      `The scheme declares UNTP version "${version}", but this Playground has schema layouts only for UNTP 0.7.0 and later.`,
      'scheme-version-unsupported',
    );
    throw error;
  }

  let schemaUrl: string;
  try {
    schemaUrl = buildUntpArtefactUrls('ConformityScheme', version).schemaUrl;
  } catch (error) {
    if (error instanceof Error) {
      throw new SchemaSelectionError(`The Playground could not build a scheme schema URL: ${error.message}`, 'builder');
    }
    throw error;
  }

  const schema = await fetchSchema(schemaUrl);
  const result = validateSchemaDocument(schema, scheme, schemaUrl, 'scheme');
  return { ...result, schemaUrl };
}
