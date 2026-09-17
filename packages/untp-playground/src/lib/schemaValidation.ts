import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020';
import type Ajv from 'ajv';
import type { ValidateFunction } from 'ajv';
import { VCDM_SCHEMA_URLS, VCDMVersion } from '../../constants';
import {
  buildUntpArtefactUrls,
  detectVersionFromContext,
  UNTP_SHORT_CREDENTIAL_TYPES,
} from '@uncefact/untp-utils/artefacts';
import { detectCredentialType } from './credentialService';
import {
  classifySchemaCompileFailure,
  classifySchemaDialectFailure,
  classifySchemaMetaFailure,
  classifySchemaPayloadFailure,
  type ArtefactFailureFamily,
  type ArtefactStepFailure,
} from './artefactFailure';
import { fetchSchema, schemaCache, SchemaFetchError, SchemaSelectionError } from './schemaFetch';

export { SchemaFetchError, SchemaSelectionError, schemaCache };

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false,
  verbose: true,
});
addFormats(ajv);

const CARRIED_DIALECT = 'https://json-schema.org/draft/2020-12/schema';

export interface SchemaValidationResult {
  valid: boolean;
  errors?: any[];
  failure?: ArtefactStepFailure;
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

function findExtensionSchemaURL(type: string, version: string): string | undefined {
  return EXTENSION_VERSIONS[type]?.versions.find((entry) => entry.version === version)?.schema;
}

/** Formats an observed value, capping untrusted document-declared output at 200 characters. */
export function formatObserved(value: unknown): string {
  if (value === undefined || (Array.isArray(value) && value.length === 0)) return 'nothing';
  try {
    const serialised = JSON.stringify(value) ?? String(value);
    return serialised.length > 200 ? `${serialised.slice(0, 197)}...` : serialised;
  } catch {
    const stringValue = String(value);
    return stringValue.length > 200 ? `${stringValue.slice(0, 197)}...` : stringValue;
  }
}

/** Returns the credential @context entries in the form used by selection diagnostics. */
export function contextEntries(credential: any): unknown[] {
  const context = credential?.['@context'];
  return Array.isArray(context) ? context : context === undefined ? [] : [context];
}

function typeEntries(credential: any): unknown[] {
  const type = credential?.type;
  return Array.isArray(type) ? type : type === undefined ? [] : [type];
}

function extensionVersionObservation(credential: any, extension: ExtensionConfig): string | undefined {
  const entries = contextEntries(credential).filter(
    (entry): entry is string => typeof entry === 'string' && entry.includes(extension.domain),
  );
  return entries.length > 0 ? formatObserved(entries) : undefined;
}

function unsupportedExtensionMessage(credential: any, extension: ExtensionConfig): string {
  const observed = extensionVersionObservation(credential, extension);
  return observed
    ? `The credential declares extension context ${observed}, but none matches the registered extension versions ${extension.versions
        .map((entry) => entry.version)
        .join(', ')}.`
    : 'The credential declares no recognised extension context entries, so no registered extension version can be detected.';
}

/** Keeps filename-shaped extension contexts working alongside the shared detector. */
function detectExtensionVersion(credential: any, domain: string): string | undefined {
  const extensionContext = contextEntries(credential).find(
    (entry): entry is string => typeof entry === 'string' && entry.includes(domain),
  );
  if (!extensionContext) return undefined;

  const canonicalVersion = detectVersionFromContext({ '@context': [extensionContext] }, { domain });
  if (canonicalVersion) return canonicalVersion;
  return extensionContext.match(/(\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+)?)/)?.[1];
}

/** Extracts a schema's declared dialect when the root carries one. */
export function schemaDialect(schema: unknown): string | undefined {
  return typeof schema === 'object' && schema !== null && !Array.isArray(schema) && '$schema' in schema
    ? typeof (schema as { $schema?: unknown }).$schema === 'string'
      ? (schema as { $schema: string }).$schema
      : undefined
    : undefined;
}

function schemaRootError(schema: unknown): any {
  const type = schema === null ? 'null' : Array.isArray(schema) ? 'array' : typeof schema;
  return {
    keyword: 'type',
    instancePath: '',
    message: `schema must be an object or boolean, received ${type}`,
    params: { type: ['object', 'boolean'] },
    data: schema,
  };
}

function isObjectOrBoolean(schema: unknown): schema is Record<string, unknown> | boolean {
  return typeof schema === 'boolean' || (typeof schema === 'object' && schema !== null && !Array.isArray(schema));
}

function familyForExtension(extension: boolean): ArtefactFailureFamily {
  return extension ? 'extension' : 'credential';
}

/** Applies the root type, carried-dialect and Ajv meta-schema checks before compilation. */
export function validateSchemaRoot(
  schema: unknown,
  schemaUrl: string,
  family: ArtefactFailureFamily,
  validator: Ajv = ajv,
  carriedDialect = CARRIED_DIALECT,
):
  | { valid: true; schema: Record<string, unknown> | boolean }
  | { valid: false; errors: any[]; failure: ArtefactStepFailure } {
  if (!isObjectOrBoolean(schema)) {
    const errors = [schemaRootError(schema)];
    return {
      valid: false,
      errors,
      failure: classifySchemaMetaFailure(schemaUrl, errors[0].message, family),
    };
  }

  const dialect = schemaDialect(schema);
  if (dialect && dialect !== carriedDialect && dialect !== `${carriedDialect}#`) {
    return {
      valid: false,
      errors: [],
      failure: classifySchemaDialectFailure(schemaUrl, dialect, family),
    };
  }

  try {
    if (!validator.validateSchema(schema)) {
      const errors = [...(validator.errors ?? [])];
      const diagnostic =
        errors.map((error) => error.message ?? error.keyword).join('; ') || 'meta-schema validation failed';
      return {
        valid: false,
        errors,
        failure: classifySchemaMetaFailure(schemaUrl, diagnostic, family),
      };
    }
  } catch (error) {
    return {
      valid: false,
      errors: [],
      failure: classifySchemaCompileFailure(
        schemaUrl,
        error instanceof Error ? error.message : 'schema pre-check failed for an unknown reason',
        family,
      ),
    };
  }

  return { valid: true, schema };
}

/** Converts Ajv payload errors into the single credential-invalid schema outcome. */
export function payloadFailure(errors: any[], schemaUrl: string, family: ArtefactFailureFamily): ArtefactStepFailure {
  const first = errors[0];
  const fieldFree =
    errors.length === 1 &&
    first &&
    first.instancePath === '' &&
    (first.keyword === 'false schema' || first.keyword === 'not');
  if (fieldFree) {
    return classifySchemaPayloadFailure(first.message, family, {
      artefactUrl: schemaUrl,
      remediation: first.message,
    });
  }
  return classifySchemaPayloadFailure('The submitted document failed validation against the fetched schema.', family, {
    artefactUrl: schemaUrl,
  });
}

async function validateCredentialOnSchemaUrl(
  credential: any,
  schemaUrl: string,
  family: ArtefactFailureFamily,
  relaxFunction?: (schema: any) => any,
): Promise<SchemaValidationResult> {
  let schema = await fetchSchema(schemaUrl);
  if (relaxFunction && typeof schema === 'object' && schema !== null && !Array.isArray(schema)) {
    // Clone before relaxing so the shared cache keeps the published schema unchanged.
    const clone = JSON.parse(JSON.stringify(schema));
    delete clone.$id;
    schema = relaxFunction(clone);
  }

  return validateSchemaDocument(schema, credential, schemaUrl, family, {
    downgradeAdditionalProperties: true,
  });
}

export interface ValidateSchemaDocumentOptions {
  /** Treat only additionalProperties errors as a valid result for credential schemas. */
  downgradeAdditionalProperties?: boolean;
  /** Reuse a validator compiled for this exact schema object and URL. */
  compiledValidator?: ValidateFunction;
  /** Receives a newly compiled validator so the caller can cache it. */
  onCompiled?: (validate: ValidateFunction) => void;
}

/** Applies schema pre-checks and validates one document with the supplied Ajv contract. */
export function validateSchemaDocument(
  schema: unknown,
  document: unknown,
  schemaUrl: string,
  family: ArtefactFailureFamily,
  options: ValidateSchemaDocumentOptions = {},
  validator: Ajv = ajv,
  carriedDialect = CARRIED_DIALECT,
): SchemaValidationResult {
  const root = validateSchemaRoot(schema, schemaUrl, family, validator, carriedDialect);
  if (!root.valid) return { valid: false, errors: root.errors, failure: root.failure };

  try {
    const validate = options.compiledValidator ?? validator.compile(root.schema);
    if (!options.compiledValidator) options.onCompiled?.(validate);
    const valid = validate(document) === true;
    const errors = [...(validate.errors ?? [])];
    const onlyAdditionalPropertiesErrors =
      errors.length > 0 && errors.every((error) => error.keyword === 'additionalProperties');
    if (valid || (options.downgradeAdditionalProperties === true && onlyAdditionalPropertiesErrors)) {
      return { valid: true, errors };
    }
    return { valid: false, errors, failure: payloadFailure(errors, schemaUrl, family) };
  } catch (error) {
    return {
      valid: false,
      errors: [],
      failure: classifySchemaCompileFailure(
        schemaUrl,
        error instanceof Error ? error.message : 'schema compilation failed for an unknown reason',
        family,
      ),
    };
  }
}

export async function validateCredentialSchema(credential: any): Promise<SchemaValidationResult> {
  const extension = detectExtension(credential);
  const credentialType = extension ? extension.core.type : detectCredentialType(credential);

  if (!extension && Object.hasOwn(EXTENSION_VERSIONS, credentialType)) {
    const extensionConfig = EXTENSION_VERSIONS[credentialType];
    throw new SchemaSelectionError(
      unsupportedExtensionMessage(credential, extensionConfig),
      'unsupported-extension-version',
    );
  }

  if (!Object.hasOwn(UNTP_SHORT_CREDENTIAL_TYPES, credentialType)) {
    const observedTypes = typeEntries(credential);
    throw new SchemaSelectionError(
      observedTypes.length === 0
        ? 'The credential declares no type values, so the Playground could not select a UNTP schema.'
        : `The credential declares type values ${formatObserved(
            observedTypes,
          )}, but none is a UNTP type this Playground validates.`,
      'unknown-type',
    );
  }

  const version = extension?.core?.version || detectVersionFromContext(credential);
  if (!version) {
    const observedContexts = contextEntries(credential);
    throw new SchemaSelectionError(
      observedContexts.length === 0
        ? 'The credential declares no @context entries, so no UNTP version can be detected.'
        : `The credential declares @context entries ${formatObserved(
            observedContexts,
          )}, but none carries a recognised UNTP version.`,
      'version-not-detected',
    );
  }

  let schemaUrl: string;
  try {
    schemaUrl = buildUntpArtefactUrls(credentialType, version).schemaUrl;
  } catch (error) {
    if (error instanceof Error) {
      throw new SchemaSelectionError(`The Playground could not build a schema URL: ${error.message}`, 'builder');
    }
    throw error;
  }

  if (extension?.core.type === 'DigitalProductPassport' && extension?.core.version === '0.5.0') {
    const relaxFunction = (schema: any) => {
      delete schema?.properties?.type?.const;
      delete schema?.properties?.type?.items?.enum;
      delete schema?.properties?.['@context']?.const;
      delete schema?.properties?.['@context']?.items?.enum;
      return schema;
    };
    return validateCredentialOnSchemaUrl(credential, schemaUrl, familyForExtension(Boolean(extension)), relaxFunction);
  }

  return validateCredentialOnSchemaUrl(credential, schemaUrl, familyForExtension(Boolean(extension)));
}

export async function validateExtension(credential: any): Promise<SchemaValidationResult> {
  const extension = detectExtension(credential);
  if (!extension) {
    const type = detectCredentialType(credential);
    const config = EXTENSION_VERSIONS[type];
    const observedTypes = typeEntries(credential);
    throw new SchemaSelectionError(
      config
        ? unsupportedExtensionMessage(credential, config)
        : observedTypes.length === 0
          ? 'The credential declares no type values, so the Playground could not select a registered extension.'
          : `The credential declares type values ${formatObserved(
              observedTypes,
            )}, but no registered extension matches them.`,
      'unsupported-extension-version',
    );
  }

  const schemaUrl = findExtensionSchemaURL(extension.extension.type, extension.extension.version);
  if (!schemaUrl) {
    throw new SchemaSelectionError(
      `The credential declares extension version ${extension.extension.version}, but the Playground has no registered schema for it.`,
      'unsupported-extension-version',
    );
  }

  return validateCredentialOnSchemaUrl(credential, schemaUrl, 'extension');
}

export function detectExtension(credential: any):
  | {
      core: { type: string; version: string };
      extension: { type: string; version: string };
    }
  | undefined {
  const credentialType = detectCredentialType(credential);
  const extension = EXTENSION_VERSIONS[credentialType];
  if (!extension) return undefined;
  const version = detectExtensionVersion(credential, extension.domain);
  const extensionVersion = extension.versions.find((entry) => entry.version === version);
  if (!extensionVersion) return undefined;

  return {
    core: extensionVersion.core,
    extension: { type: credentialType, version: extensionVersion.version },
  };
}

export async function validateVcAgainstSchema(
  credential: any,
  version: Extract<VCDMVersion, VCDMVersion.V2>,
): Promise<SchemaValidationResult> {
  const schemaUrl = VCDM_SCHEMA_URLS[version];
  if (!schemaUrl) {
    throw new SchemaSelectionError(
      `The credential declares VCDM context version "${version}", but this Playground has no schema mapped for it.`,
      'vcdm-version-unmapped',
    );
  }
  return validateCredentialOnSchemaUrl(credential, schemaUrl, 'vcdm');
}
