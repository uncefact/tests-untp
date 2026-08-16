/**
 * Zod schemas for API documentation.
 *
 * Domain schemas are owned by the services package and imported here.
 * Only credential schemas remain local (no credential service directory yet).
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import {
  // DID schemas
  didResponseSchema,
  verificationCheckSchema,
  verificationResultResponseSchema,
  didDocumentResponseSchema,
  // IDR schemas
  registrarSchema,
  schemeQualifierSchema,
  identifierSchemeSchema,
  identifierSchema,
  linkRegistrationSchema,
  // Service instance schemas
  serviceInstanceResponseSchema,
  // Shared schemas
  errorResponseSchema,
  AccessRole,
} from '@uncefact/untp-ri-services';
import { paginationMetaSchema } from '@/lib/api/pagination';

// ============================================================================
// Credential Schemas (remain local — no credential service directory yet)
// ============================================================================

const storageOptionsSchema = z.object({
  serviceInstanceId: z.string().optional().describe('Storage service instance ID'),
  encrypt: z.boolean().optional().describe('Whether to encrypt the stored credential'),
});

export const publishingOptionsSchema = z.object({
  publish: z.boolean().optional().describe('Whether to publish the credential to the Identity Resolver'),
  linkType: z
    .string()
    .optional()
    .describe("UNTP link relation type (defaults to the IDR service's configured default link type)"),
  linkTitle: z.string().optional().describe('Title for the published link (defaults to data model name)'),
  qualifierPath: z
    .string()
    .optional()
    .describe('Qualifier path for sub-identifiers (e.g. /10/LOT123/21/SER456). Defaults to /'),
  machineVerificationUrl: z.string().optional().describe('Machine verification URL'),
  humanVerificationUrl: z
    .string()
    .optional()
    .describe(
      'Human verification URL. When publishing without one, defaults to this RI verify page, ${RI_APP_URL}/verify',
    ),
  hreflang: z
    .array(z.string().min(1))
    .optional()
    .describe('BCP 47 language tags the credential resource is available in (attached to the credential link only)'),
  additionalRels: z
    .array(z.string().min(1))
    .optional()
    .describe('Additional link relation types qualifying the credential link beyond its primary rel'),
  public: z
    .boolean()
    .optional()
    .describe(
      'Whether the credential target URL is safe to publish in a public directory. Distinct from access control on the resource content',
    ),
  accessRole: z
    .array(z.nativeEnum(AccessRole))
    .optional()
    .describe(
      'UNTP access roles governing who the published links are surfaced to, attached to the credential and human verification links (e.g. untp:accessRole#Regulator)',
    ),
});

/** Request body for POST /credentials. */
export const credentialIssueRequestSchema = z.object({
  credentialPayload: z.record(z.unknown()).describe('The full credential payload to sign'),
  credentialType: z
    .string()
    .describe('Type of credential to issue (e.g. DigitalProductPassport, DigitalLivestockPassport)'),
  version: z.string().describe('Data model version'),
  storageOptions: storageOptionsSchema.optional().describe('Storage service options'),
  publishingOptions: publishingOptionsSchema.optional().describe('IDR publishing options'),
});

/** Advisory warning that may accompany a credential-issue response. */
export const credentialWarningSchema = z.object({
  code: z.string().describe('Warning code'),
  message: z.string().describe('Human-readable warning message'),
});

/** Successful credential issue response from POST /credentials. */
export const credentialIssueResponseSchema = z.object({
  credentialId: z.string().describe('Database ID of the stored credential record'),
  warnings: z.array(credentialWarningSchema).optional().describe('Advisory warnings (e.g. publishing failures)'),
});

/** Credential resource as returned by GET /credentials and GET /credentials/:id. */
export const credentialSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Tenant ID'),
  storageUri: z.string().describe('URI where the credential is stored'),
  digestMultibase: z.string().describe('Multibase-encoded multihash digest of the stored credential content'),
  credentialType: z.string().describe('Type of credential (e.g. DigitalProductPassport)'),
  decryptionKey: z.string().nullable().describe('AES-GCM decryption key (null if unencrypted)'),
  isPublished: z.boolean().describe('Whether the credential has been published to IDR'),
  organisationId: z.string().nullable().describe('ID of the linked organisation entity (null if none)'),
  facilityId: z.string().nullable().describe('ID of the linked facility entity (null if none)'),
  productId: z.string().nullable().describe('ID of the linked product entity (null if none)'),
  createdAt: z.string().datetime().describe('ISO 8601 timestamp'),
  updatedAt: z.string().datetime().describe('ISO 8601 timestamp'),
});

// ============================================================================
// Data Model Schemas
// ============================================================================

/**
 * DataModel resource representation.
 */
export const dataModelSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  name: z.string(),
  credentialType: z.string(),
  version: z.string(),
  isExtension: z.boolean(),
  parentConfigId: z.string().nullable(),
  schemaUrl: z.string(),
  contextUrl: z.string(),
  websiteUrl: z.string().nullable(),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  updatedAt: z.string().describe('ISO 8601 timestamp'),
});

/**
 * RenderTemplate resource representation.
 */
export const renderTemplateSchema = z.object({
  id: z.string(),
  tenantId: z.string().nullable(),
  dataModelId: z.string(),
  name: z.string(),
  storageUrl: z.string(),
  digestMultibase: z.string(),
  isDefault: z.boolean(),
  renderMethodType: z.string(),
  inline: z.boolean().nullable(),
  mediaType: z.string().nullable(),
  mediaQuery: z.string().nullable(),
  storageExternalId: z.string().nullable(),
  storageBucket: z.string().nullable(),
  storageContentType: z.string().nullable(),
  storageServiceInstanceId: z.string().nullable(),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  updatedAt: z.string().describe('ISO 8601 timestamp'),
});

// ============================================================================
// Master Data Schemas
// ============================================================================

export const productSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  level: z.enum(['MODEL', 'BATCH', 'ITEM']),
  description: z.string().nullable(),
  batchNumber: z.string().nullable(),
  serialNumber: z.string().nullable(),
  parentId: z.string().nullable(),
  producedByOrganisationId: z.string().nullable(),
  manufacturingFacilityId: z.string().nullable(),
  primaryIdentifierId: z.string().nullable(),
  secondaryIdentifierIds: z.array(z.string()).describe('IDs of secondary identifiers'),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  updatedAt: z.string().describe('ISO 8601 timestamp'),
});

/**
 * Builds the Organisation response schema, including its nested
 * primary/secondary identifier sub-schemas.
 *
 * Built lazily (called only from generateOpenAPISchemas, never at
 * module-evaluation time): every nested schema here derives from
 * identifierSchemeSchema/identifierSchema via `.omit()`/`.required()`/
 * `.extend()`, all imported from `@uncefact/untp-ri-services`. A consumer
 * that imports anything else from this module under a partial mock of that
 * package (e.g. credentials/route.test.ts, which mocks only
 * `buildPublishLinks`) would see those two schemas as `undefined` and throw
 * at import time if this derivation ran at the top level, before the test
 * ever reaches the code it means to exercise.
 */
function buildOrganisationSchema() {
  /**
   * Identifier scheme nested under an organisation's identifier fields.
   * Omits `qualifiers`: the repository's include
   * (`scheme: { include: { registrar: true } }`) does not request the
   * qualifiers relation, so it is never present on this nested view (unlike
   * the standalone IdentifierScheme resource, which always includes it).
   * `registrar` is made required here (it is optional on the standalone
   * resource to match its own list-versus-detail asymmetry) because this
   * nested view's include always requests it.
   */
  const organisationIdentifierSchemeSchema = identifierSchemeSchema.omit({ qualifiers: true }).required({
    registrar: true,
  });

  /**
   * Identifier record nested under an organisation's primary/secondary
   * identifier fields, including its parent scheme (and that scheme's
   * registrar), matching the repository's ORGANISATION_DETAIL_INCLUDE
   * (`scheme: { include: { registrar: true } }`).
   */
  const organisationIdentifierSchema = identifierSchema.extend({
    scheme: organisationIdentifierSchemeSchema.describe('Parent identifier scheme, including its registrar'),
  });

  /**
   * Secondary identifier join record as returned nested under an
   * organisation's detail response, matching
   * ORGANISATION_DETAIL_INCLUDE.secondaryIdentifiers.
   */
  const organisationSecondaryIdentifierSchema = z.object({
    organisationId: z.string(),
    identifierId: z.string(),
    identifier: organisationIdentifierSchema,
  });

  // The create, get-by-id, and update handlers all include the full
  // `primaryIdentifier` and `secondaryIdentifiers` relations
  // (ORGANISATION_DETAIL_INCLUDE); the list handler instead returns the
  // lighter-weight `secondaryIdentifierIds` and omits both nested relations
  // (ORGANISATION_LIST_INCLUDE), so the relation fields and
  // `secondaryIdentifierIds` are each marked optional to match that
  // asymmetry rather than overstating what every endpoint returns.
  return z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    location: z
      .record(z.unknown())
      .nullable()
      .describe(
        'Location object. Any JSON object is accepted; the UNTP location field shapes described in the master data documentation are not currently validated.',
      ),
    primaryIdentifierId: z.string().nullable(),
    primaryIdentifier: organisationIdentifierSchema
      .nullable()
      .optional()
      .describe('Full primary identifier record (omitted on list items)'),
    secondaryIdentifierIds: z.array(z.string()).optional().describe('IDs of secondary identifiers (list items only)'),
    secondaryIdentifiers: z
      .array(organisationSecondaryIdentifierSchema)
      .optional()
      .describe('Full secondary identifier records (omitted on list items)'),
    createdAt: z.string().describe('ISO 8601 timestamp'),
    updatedAt: z.string().describe('ISO 8601 timestamp'),
  });
}

export const facilitySchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  location: z.record(z.unknown()).nullable().describe('UNTP location object'),
  operatingOrganisationId: z.string().nullable(),
  primaryIdentifierId: z.string().nullable(),
  secondaryIdentifierIds: z.array(z.string()).describe('IDs of secondary identifiers'),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  updatedAt: z.string().describe('ISO 8601 timestamp'),
});

// ============================================================================
// Re-export imported schemas so existing consumers continue to work
// ============================================================================

export {
  didResponseSchema,
  verificationCheckSchema,
  verificationResultResponseSchema,
  didDocumentResponseSchema,
  registrarSchema,
  schemeQualifierSchema,
  identifierSchemeSchema,
  identifierSchema,
  linkRegistrationSchema,
  serviceInstanceResponseSchema,
  errorResponseSchema,
  paginationMetaSchema,
};

// ============================================================================
// Schema Conversion Utility
// ============================================================================

type OpenAPISchema = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [key: string]: unknown;
};

/**
 * Converts Zod schemas to OpenAPI-compatible JSON schemas.
 */
export function generateOpenAPISchemas(): Record<string, OpenAPISchema> {
  const schemas: Record<string, z.ZodType> = {
    Did: didResponseSchema,
    ErrorResponse: errorResponseSchema,
    VerificationResult: verificationResultResponseSchema,
    PaginationMeta: paginationMetaSchema,
    VerificationCheck: verificationCheckSchema,
    DidDocument: didDocumentResponseSchema,
    CredentialIssueRequest: credentialIssueRequestSchema,
    CredentialIssueResponse: credentialIssueResponseSchema,
    Credential: credentialSchema,
    CredentialWarning: credentialWarningSchema,
    Registrar: registrarSchema,
    SchemeQualifier: schemeQualifierSchema,
    IdentifierScheme: identifierSchemeSchema,
    Identifier: identifierSchema,
    LinkRegistration: linkRegistrationSchema,
    ServiceInstance: serviceInstanceResponseSchema,
    DataModel: dataModelSchema,
    RenderTemplate: renderTemplateSchema,
    Product: productSchema,
    Organisation: buildOrganisationSchema(),
    Facility: facilitySchema,
  };

  const openAPISchemas: Record<string, OpenAPISchema> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    const jsonSchema = zodToJsonSchema(schema, {
      target: 'openApi3',
      $refStrategy: 'none',
    });

    // Remove the $schema property as it's not needed in OpenAPI
    const schemaObj = jsonSchema as Record<string, unknown>;
    delete schemaObj.$schema;
    openAPISchemas[name] = schemaObj as OpenAPISchema;
  }

  return openAPISchemas;
}
