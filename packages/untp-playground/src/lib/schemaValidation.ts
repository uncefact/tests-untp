import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import {
  API_BASE_PATH,
  UNTP_CORE_SCHEMA_FILENAMES,
  UNTP_SHORT_CREDENTIAL_TYPES,
  VCDM_SCHEMA_URLS,
  VCDMVersion,
} from '../../constants';
import { detectCredentialType, detectVersion } from './credentialService';
import { schemaCache } from './schemaFetch';
import { isUntpV070OrAbove } from './utils';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

/**
 * A schema the proxy route could not deliver. `message` carries the route's
 * own category (host unreachable, upstream status, not JSON, host not on the
 * allowlist) so the verifier sees why, not just that it failed. `upstreamStatus`
 * is the schema host's own status when the route reported one.
 */
export class SchemaFetchError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly upstreamStatus?: number,
  ) {
    super(message);
    this.name = 'SchemaFetchError';
  }
}

/**
 * What the verifier can do about a schema fetch failure. A 4xx from the schema
 * host (or a URL the route refused) means the host has nothing at the URL built
 * from the type and version the credential declares, which the credential's own
 * `@context` may be causing. The published hosts answer 403, not 404, for a
 * missing path, so the whole 4xx range is read that way. Anything else is the
 * host, and the credential is unassessed rather than cleared.
 */
export function schemaFetchFailureAdvice(error: SchemaFetchError): { missingValue: string; solution: string } {
  const upstream = error.upstreamStatus;
  if ((upstream !== undefined && upstream >= 400 && upstream < 500) || error.status === 400) {
    return {
      missingValue:
        'The schema host has no schema at the URL built from the type and UNTP version this credential declares.',
      solution:
        "Check the credential's type and the UNTP version in its '@context'. If both are right, the host may be refusing requests: retry in a moment, then report the message above to the Playground operator.",
    };
  }
  return {
    missingValue: 'The schema could not be loaded, so this check could not determine whether the credential conforms.',
    solution: 'Retry in a moment. If it keeps failing, report the message above to the Playground operator.',
  };
}

// The proxy names the failure category in its body; fall back to the transport
// status when the body is missing or not the shape this route publishes.
async function readErrorBody(response: Response): Promise<{ reason: string; upstreamStatus?: number }> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string') {
      return {
        reason: body.error,
        ...(typeof body.upstreamStatus === 'number' && { upstreamStatus: body.upstreamStatus }),
      };
    }
  } catch {
    // Fall through to the transport status below.
  }
  return { reason: `${response.status} ${response.statusText}` };
}

// The session cache lives in schemaFetch.ts (the utils TTL cache) so every family shares it; the
// export stays here for the callers and tests that read it from this module. The cache also
// de-duplicates concurrent requests for one URL, so this module keeps no in-flight map of its own.
export { schemaCache };

function fetchSchema(schemaUrl: string): Promise<any> {
  return schemaCache.get(schemaUrl, async () => {
    const proxyUrl = `${API_BASE_PATH}/api/schema?url=${encodeURIComponent(schemaUrl)}`;
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      const { reason, upstreamStatus } = await readErrorBody(response);
      throw new SchemaFetchError(`Failed to fetch schema: ${reason}`, response.status, upstreamStatus);
    }
    return response.json();
  });
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

  // detectVersion reports a missing or unparseable UNTP context as the string
  // 'unknown', which must not become a schema URL.
  if (!version || version === 'unknown') {
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
