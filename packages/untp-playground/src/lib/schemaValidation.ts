import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
});
addFormats(ajv);

const schemaCache = new Map<string, any>();

const SCHEMA_URLS = {
  DigitalProductPassport: 'https://test.uncefact.org/vocabulary/untp/dpp/untp-dpp-schema-0.5.0.json',
  DigitalConformityCredential: 'https://test.uncefact.org/vocabulary/untp/dcc/untp-dcc-schema-0.5.0.json',
  DigitalTraceabilityEvent: 'https://test.uncefact.org/vocabulary/untp/dte/untp-dte-schema-0.5.0.json',
  DigitalFacilityRecord: 'https://test.uncefact.org/vocabulary/untp/dfr/untp-dfr-schema-0.5.0.json',
  DigitalIdentityAnchor: 'https://test.uncefact.org/vocabulary/untp/dia/untp-dia-schema-0.2.1.json',
};

export async function validateCredentialSchema(credential: any): Promise<{
  valid: boolean;
  errors?: any[];
}> {
  try {
    const credentialType = credential.type.find((t: string) => Object.keys(SCHEMA_URLS).includes(t));

    if (!credentialType) {
      throw new Error('Unsupported credential type');
    }

    const schemaUrl = SCHEMA_URLS[credentialType as keyof typeof SCHEMA_URLS];

    if (!schemaCache.has(schemaUrl)) {
      const proxyUrl = `/untp-playground/api/schema?url=${encodeURIComponent(schemaUrl)}`;
      const schemaResponse = await fetch(proxyUrl);

      if (!schemaResponse.ok) {
        throw new Error(`Failed to fetch schema: ${schemaResponse.statusText}`);
      }

      const schema = await schemaResponse.json();
      schemaCache.set(schemaUrl, schema);
    }

    const schema = schemaCache.get(schemaUrl);
    const validate = ajv.compile(schema);
    const isValid = validate(credential);
    const errors = validate.errors || [];

    console.log('errors', errors);

    // Check if all errors are additionalProperties
    const onlyAdditionalPropertiesErrors = errors.every((error) => error.keyword === 'additionalProperties');

    return {
      valid: isValid || onlyAdditionalPropertiesErrors,
      errors: errors,
    };
  } catch (error) {
    console.log('Schema validation error:', error);
    throw error;
  }
}
