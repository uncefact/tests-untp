import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import { detectCredentialType, detectVersion } from './credentialService';

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

const EXTENSION_VERSIONS: Record<
  string,
  { domain: string; versions: { version: string; core: { type: string; version: string } }[] }
> = {
  DigitalLivestockPassport: {
    domain: 'aatp.foodagility.com',
    versions: [
      {
        version: '0.4.0',
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
      },
    ],
  },
};

const schemaURLConstructor = (type: string, version: string) => {
  const shortCredentialTypes: Record<string, string> = {
    DigitalProductPassport: 'dpp',
    DigitalConformityCredential: 'dcc',
    DigitalTraceabilityEvent: 'dte',
    DigitalFacilityRecord: 'dfr',
    DigitalIdentityAnchor: 'dia',
  };
  return `https://test.uncefact.org/vocabulary/untp/${shortCredentialTypes[type]}/untp-${shortCredentialTypes[type]}-schema-${version}.json`;
};

const extensionSchemaURLConstructor = (type: string, version: string) => {
  const shortCredentialTypes: Record<string, string> = {
    DigitalLivestockPassport: 'dlp',
  };
  if (type === 'DigitalLivestockPassport' && version === '0.4.0') {
    return 'https://aatp.foodagility.com/assets/files/aatp-dlp-schema-0.4.0-9c0ad2b1ca6a9e497dedcfd8b87f35f1.json';
  }
  return `https://aatp.foodagility.com/vocabulary/aatp/${shortCredentialTypes[type]}/aatp-${shortCredentialTypes[type]}-schema-${version}.json`;
};

export async function validateCredentialSchema(credential: any): Promise<{
  valid: boolean;
  errors?: any[];
}> {
  const extension = detectExtension(credential);
  const credentialType = extension ? extension.core.type : detectCredentialType(credential);

  if (credentialType === 'Unknown') {
    throw new Error('Unsupported credential type');
  }

  const version = extension?.core?.version || detectVersion(credential);

  if (!version) {
    throw new Error('Unsupported version');
  }

  const schemaUrl = schemaURLConstructor(credentialType, version);

  if (extension?.core.type === 'DigitalProductPassport' && extension?.core.version === '0.5.0') {
    const relaxFunction = (schema: any) => {
      delete schema?.properties?.type?.const;
      delete schema?.properties?.type?.items?.enum;
      delete schema?.properties?.['@context']?.const;
      delete schema?.properties?.['@context']?.items?.enum;
      return schema;
    };
    return validateCredentialOnSchemaUrl(credential, schemaUrl, relaxFunction);
  }

  return validateCredentialOnSchemaUrl(credential, schemaUrl);
}

export async function validateExtension(credential: any): Promise<{
  valid: boolean;
  errors?: any[];
}> {
  const extension = detectExtension(credential);
  if (!extension) {
    throw new Error('Unknown extension');
  }

  const schemaUrl = extensionSchemaURLConstructor(extension.extension.type, extension.extension.version);

  return validateCredentialOnSchemaUrl(credential, schemaUrl);
}

export function detectExtension(credential: any):
  | {
      core: { type: string; version: string };
      extension: { type: string; version: string };
    }
  | undefined {
  const credentialType = detectCredentialType(credential);
  const extension = EXTENSION_VERSIONS[credentialType];
  if (!extension) {
    return undefined;
  }
  const version = detectVersion(credential, extension.domain);
  const extensionVersion = extension.versions.find((v) => v.version === version);
  if (!extensionVersion) {
    return undefined;
  }

  return {
    core: extensionVersion.core,
    extension: { type: credentialType, version },
  };
}

async function validateCredentialOnSchemaUrl(credential: any, schemaUrl: string, relaxFunction?: (schema: any) => any) {
  try {
    if (!schemaCache.has(schemaUrl)) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_PATH || '';
      const proxyUrl = `${baseUrl}/api/schema?url=${encodeURIComponent(schemaUrl)}`;
      const schemaResponse = await fetch(proxyUrl);

      if (!schemaResponse.ok) {
        throw new Error(`Failed to fetch schema: ${schemaResponse.statusText}`);
      }

      const schema = await schemaResponse.json();
      schemaCache.set(schemaUrl, schema);
    }

    let schema = schemaCache.get(schemaUrl);
    if (relaxFunction) {
      schema = relaxFunction(schema);
    }

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
