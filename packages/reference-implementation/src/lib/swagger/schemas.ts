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
} from '@uncefact/untp-ri-services';
import { paginationMetaSchema } from '@/lib/api/pagination';
import { credentialIssueRequestSchema } from '@/lib/api/request-schemas/credential';
import {
  conformitySchemeSummarySchema,
  conformityProfileSummarySchema,
  conformityCriterionSummarySchema,
} from '@/lib/prisma/repositories/conformity-scheme.schemas';

/** See the CredentialIssueRequest handling in generateOpenAPISchemas. */
function stripAdditionalPropertiesFalse(node: unknown): void {
  if (Array.isArray(node)) {
    node.forEach(stripAdditionalPropertiesFalse);
    return;
  }
  if (node === null || typeof node !== 'object') return;
  const record = node as Record<string, unknown>;
  if (record.additionalProperties === false) {
    delete record.additionalProperties;
  }
  Object.values(record).forEach(stripAdditionalPropertiesFalse);
}

// ============================================================================
// Credential Schemas (remain local — no credential service directory yet)
// ============================================================================

/** Advisory warning that may accompany a credential-issue response. */
export const credentialWarningSchema = z.object({
  code: z
    .string()
    .describe(
      'Warning code. Publishing codes: `REFS_EXTRACTION_FAILED` (no identifier could be read from the payload), `PUBLISH_REFERENCE_MISSING` (the payload carries no identifier to publish under), `PUBLISH_SCHEME_INCOMPLETE` (the identifier resolved to a scheme missing a primary key or registrar namespace), `PUBLISH_IDENTIFIER_UNKNOWN` (no identifier registered for the value), `PUBLISH_IDENTIFIER_AMBIGUOUS` (the value exists under more than one scheme; set publishingOptions.identifierSchemeId), `PUBLISH_IDR_UNAVAILABLE` (no identity resolver service is configured), `PUBLISH_TARGET_UNRESOLVED` (the identifier lookup itself failed), `IDR_PUBLISH_FAILED` (the resolver rejected the links), `IDR_PUBLISH_UNCONFIRMED` (the resolver could not be reached, so whether the links were registered is unknown), `DB_STATUS_UPDATE_FAILED` (the links are live but the stored status was not saved). `ENTITY_LINK_FAILED` reports that the credential could not be linked to a master-data record, which does not affect publishing.',
    ),
  message: z.string().describe('Human-readable warning message'),
  received: z.unknown().optional().describe('The value that triggered the warning, where one applies'),
  expected: z.unknown().optional().describe('The value or shape that was expected, where one applies'),
  remediation: z.string().optional().describe('What the caller can do about the warning, where known'),
  pointer: z
    .string()
    .optional()
    .describe('JSON pointer to the payload location the warning concerns, where one applies'),
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

/**
 * Builds the Facility response schema. This must stay lazy (called only from
 * generateOpenAPISchemas, never derived at module top level): a test suite
 * that partially mocks '@uncefact/untp-ri-services' (e.g. mocking only one
 * export) leaves this module's other imports from that package undefined at
 * module-evaluation time, and a top-level `.omit()`/`.extend()` chained off
 * an undefined import throws before any test in that suite runs.
 */
function buildFacilitySchema() {
  /**
   * Identifier scheme as embedded in a facility's identifier relations.
   * FACILITY_DETAIL_INCLUDE's `scheme` include fetches `registrar` but not
   * `qualifiers`, unlike the identifier scheme endpoints; `qualifiers` is
   * therefore omitted (never returned via this path) and `registrar` is
   * required (always returned via this path), narrowing identifierSchemeSchema
   * to match.
   *
   * `registrar` is made required in place rather than reassigned to
   * `registrarSchema`. The nested registrar is deliberately the truncated
   * shape, without the `schemes` array the standalone Registrar resource
   * carries, because this include fetches the registrar's own columns only.
   * Substituting the top-level schema would republish that array here and
   * promise consumers a list of the registrar's other schemes that no
   * facility response ever returns.
   */
  const facilityIdentifierSchemeSchema = identifierSchemeSchema
    .omit({ qualifiers: true })
    .required({ registrar: true });

  /**
   * Identifier as embedded in a facility's `primaryIdentifier` and secondary
   * identifier relations, which eagerly load the owning scheme and its
   * registrar (needed to construct ISO 18975 resolver URIs); mirrors
   * FACILITY_DETAIL_INCLUDE in facility.repository.ts.
   */
  const facilityIdentifierWithSchemeSchema = identifierSchema.extend({
    scheme: facilityIdentifierSchemeSchema,
  });

  /**
   * A facility's secondary-identifier join record, as returned by the detail
   * endpoints (GET /facilities/{id}, POST, PATCH); mirrors
   * FACILITY_DETAIL_INCLUDE's `secondaryIdentifiers` include.
   */
  const facilitySecondaryIdentifierLinkSchema = z.object({
    facilityId: z.string(),
    identifierId: z.string(),
    identifier: facilityIdentifierWithSchemeSchema,
  });

  /**
   * A facility's operating organisation as embedded via `operatingOrganisation:
   * true` in FACILITY_DETAIL_INCLUDE: the organisation's own columns only, not
   * its identifier relations.
   */
  const facilityOperatingOrganisationSchema = z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    location: z.record(z.unknown()).nullable().describe('UNTP location object'),
    primaryIdentifierId: z.string().nullable(),
    createdAt: z.string().describe('ISO 8601 timestamp'),
    updatedAt: z.string().describe('ISO 8601 timestamp'),
  });

  // Facility record as returned by the REST API. GET /facilities/{id}, POST,
  // and PATCH all include `primaryIdentifier`, `secondaryIdentifiers`, and
  // `operatingOrganisation` (FACILITY_DETAIL_INCLUDE); GET /facilities (list)
  // includes none of those but flattens secondary identifiers to
  // `secondaryIdentifierIds` instead (FACILITY_LIST_INCLUDE). Both groups are
  // marked optional here to match that list-versus-detail asymmetry.
  return z.object({
    id: z.string(),
    tenantId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    location: z.record(z.unknown()).nullable().describe('UNTP location object'),
    operatingOrganisationId: z.string().nullable(),
    primaryIdentifierId: z.string().nullable(),
    createdAt: z.string().describe('ISO 8601 timestamp'),
    updatedAt: z.string().describe('ISO 8601 timestamp'),
    secondaryIdentifierIds: z
      .array(z.string())
      .optional()
      .describe('IDs of secondary identifiers (list responses only)'),
    primaryIdentifier: facilityIdentifierWithSchemeSchema
      .nullable()
      .optional()
      .describe('Primary identifier with its scheme and registrar (detail responses only)'),
    secondaryIdentifiers: z
      .array(facilitySecondaryIdentifierLinkSchema)
      .optional()
      .describe('Secondary identifier links, each with its identifier, scheme, and registrar (detail responses only)'),
    operatingOrganisation: facilityOperatingOrganisationSchema
      .nullable()
      .optional()
      .describe('Operating organisation (detail responses only)'),
  });
}

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
    Facility: buildFacilitySchema(),
    ConformityScheme: conformitySchemeSummarySchema,
    ConformityProfile: conformityProfileSummarySchema,
    ConformityCriterion: conformityCriterionSummarySchema,
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
    // Request components mirror parseRequestBody's runtime behaviour, which
    // strips unknown keys and accepts the request (ADR-037). The converter
    // emits `additionalProperties: false` for every plain object, which
    // would document those same requests as rejected, so the request
    // component drops that assertion at every nesting level. Response
    // components keep it: their shapes are server-produced and closed.
    if (name === 'CredentialIssueRequest') {
      stripAdditionalPropertiesFalse(schemaObj);
    }
    openAPISchemas[name] = schemaObj as OpenAPISchema;
  }

  return openAPISchemas;
}
