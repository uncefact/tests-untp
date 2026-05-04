import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import {
  UNTP_CORE_SCHEMA_FILENAMES,
  UNTP_SHORT_CREDENTIAL_TYPES,
  VCDM_SCHEMA_URLS,
  VCDMVersion,
} from '../../constants';
import { detectCredentialType, detectVersion } from './credentialService';
import { isUntpV070OrAbove } from './utils';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

export const schemaCache = new Map<string, any>();
// Stores the in-flight Promise for each URL so concurrent callers requesting the same URL
// await one shared fetch. Without this, the existing `has`/`set` cache check leaves a
// window where N callers can each see "not cached" and each issue their own fetch.
const inflightSchemaFetches = new Map<string, Promise<any>>();

async function fetchSchema(schemaUrl: string): Promise<any> {
  if (schemaCache.has(schemaUrl)) {
    return schemaCache.get(schemaUrl);
  }
  const inflight = inflightSchemaFetches.get(schemaUrl);
  if (inflight) {
    return inflight;
  }
  const baseUrl = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const proxyUrl = `${baseUrl}/api/schema?url=${encodeURIComponent(schemaUrl)}`;
  // Evict the in-flight entry once settled so a transient failure doesn't poison the cache.
  const promise = (async () => {
    try {
      const response = await fetch(proxyUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch schema: ${response.status} ${response.statusText}`);
      }
      const schema = await response.json();
      schemaCache.set(schemaUrl, schema);
      return schema;
    } finally {
      inflightSchemaFetches.delete(schemaUrl);
    }
  })();
  inflightSchemaFetches.set(schemaUrl, promise);
  return promise;
}

interface CoreVersion {
  type: string;
  version: string;
}

interface ExtensionVersion {
  version: string;
  schema: string;
  core: CoreVersion;
}

interface ExtensionConfig {
  domain: string;
  versions: ExtensionVersion[];
}

export const EXTENSION_VERSIONS: Record<string, ExtensionConfig> = {
  DigitalLivestockPassport: {
    domain: 'aatp.foodagility.com',
    versions: [
      {
        version: '0.4.0',
        schema: 'https://aatp.foodagility.com/assets/files/aatp-dlp-schema-0.4.0-9c0ad2b1ca6a9e497dedcfd8b87f35f1.json',
        core: { type: 'DigitalProductPassport', version: '0.5.0' },
      },
      {
        version: '0.4.1-beta1',
        schema: 'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.1-beta1.json',
        core: { type: 'DigitalProductPassport', version: '0.6.0-beta7' },
      },
      {
        version: '0.4.2-beta1',
        schema: 'https://aatp.foodagility.com/schema/aatp-dlp-schema-0.4.2-beta1.json',
        core: { type: 'DigitalProductPassport', version: '0.6.0-beta9' },
      },
    ],
  },
};

const schemaURLConstructor = (type: string, version: string) => {
  const shortType = UNTP_SHORT_CREDENTIAL_TYPES[type];

  if (isUntpV070OrAbove(version)) {
    const fileName = UNTP_CORE_SCHEMA_FILENAMES[type];
    return `https://untp.unece.org/artefacts/schema/v${version}/${shortType}/${fileName}.json`;
  }

  return `https://test.uncefact.org/vocabulary/untp/${shortType}/untp-${shortType}-schema-${version}.json`;
};

const findExtensionSchemaURL = (type: string, version: string) => {
  return EXTENSION_VERSIONS[type].versions.find((v) => v.version === version)?.schema;
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

  const schemaUrl = findExtensionSchemaURL(extension.extension.type, extension.extension.version);

  if (!schemaUrl) {
    throw new Error('Unsupported extension version');
  }

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
    let schema = await fetchSchema(schemaUrl);
    if (relaxFunction) {
      // Clone before relaxing so we never mutate the cached schema, and drop $id so
      // AJV compiles a fresh validator rather than returning the strict one it cached
      // by $id from an earlier non-relaxed call. JSON.parse/stringify is sufficient
      // because JSON Schema documents are by definition JSON-serialisable.
      const clone = JSON.parse(JSON.stringify(schema));
      delete clone.$id;
      schema = relaxFunction(clone);
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

/**
 * Validates a VerifiableCredential against the VCDM schema for a specific version.
 * @param credential - The VerifiableCredential to validate.
 * @param version - The VCDM version to use for validation.
 * @returns A Promise that resolves to an object containing the validation result.
 */
export async function validateVcAgainstSchema(credential: any, version: Extract<VCDMVersion, VCDMVersion.V2>) {
  const schemaUrl = VCDM_SCHEMA_URLS[version];

  if (!schemaUrl) {
    throw new Error(`Schema URL for VCDM version: ${version} not found.`);
  }

  return validateCredentialOnSchemaUrl(credential, schemaUrl);
}
