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

// ============================================================================
// Credential Schemas (remain local — no credential service directory yet)
// ============================================================================

const storageOptionsSchema = z.object({
  serviceInstanceId: z.string().optional().describe('Storage service instance ID'),
  encrypt: z.boolean().optional().describe('Whether to encrypt the stored credential'),
});

const publishingOptionsSchema = z.object({
  publish: z.boolean().optional().describe('Whether to publish the credential to the Identity Resolver'),
  linkType: z.string().optional().describe('UNTP link relation type (defaults to gs1:sustainabilityInfo)'),
  linkTitle: z.string().optional().describe('Title for the published link (defaults to data model name)'),
  qualifierPath: z
    .string()
    .optional()
    .describe('Qualifier path for sub-identifiers (e.g. /10/LOT123/21/SER456). Defaults to /'),
  machineVerificationUrl: z.string().optional().describe('Machine verification URL'),
  humanVerificationUrl: z.string().optional().describe('Human verification URL'),
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

/** CVC validation warning returned when advisory checks find issues. */
export const cvcValidationWarningSchema = z.object({
  code: z.string().describe('Warning code (e.g. CVC_UNKNOWN_CRITERION)'),
  message: z.string().describe('Human-readable warning message'),
  detail: z.string().optional().describe('Additional context (e.g. the unrecognised criterion URL)'),
});

/** Successful credential issue response from POST /credentials. */
export const credentialIssueResponseSchema = z.object({
  credentialId: z.string().describe('Database ID of the stored credential record'),
  warnings: z.array(cvcValidationWarningSchema).optional().describe('CVC compliance warnings (advisory only)'),
});

/** Credential resource as returned by GET /credentials and GET /credentials/:id. */
export const credentialSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Tenant ID'),
  storageUri: z.string().describe('URI where the credential is stored'),
  hash: z.string().describe('Content hash of the stored credential'),
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
// CVC Schemas (local — CVC is a reference-implementation concern)
// ============================================================================

/** CVC catalogue as returned by the API. */
export const cvcCatalogueSchema = z.object({
  id: z.string().describe('Database ID'),
  canonicalId: z.string().describe('JSON-LD @id from the source document'),
  name: z.string().describe('Catalogue display name'),
  sourceUrl: z.string().describe('URL the catalogue was imported from'),
  specVersion: z.string().describe('CVC spec version used to parse this catalogue (e.g. "0.7.0")'),
  metadata: z.record(z.unknown()).nullable().optional().describe('Extra JSON-LD properties'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
});

/** Import request body for POST /cvc/catalogues. */
export const cvcImportRequestSchema = z.object({
  url: z.string().url().describe('URL of the CVC JSON-LD document to import'),
  version: z.string().describe('CVC spec version to use for parsing (e.g. "0.7.0")'),
});

/** Import summary returned alongside the catalogue after import. */
export const cvcImportSummarySchema = z.object({
  schemes: z.number().int().describe('Number of schemes imported'),
  profiles: z.number().int().describe('Number of profiles imported'),
  criteria: z.number().int().describe('Number of criteria imported'),
});

/** Conformity scheme as returned by the API. */
export const conformitySchemeSchema = z.object({
  id: z.string().describe('Database ID'),
  canonicalId: z.string().describe('JSON-LD @id from the source document'),
  name: z.string().describe('Scheme display name'),
  slug: z.string().describe('URL-friendly identifier derived from the canonical ID'),
  description: z.string().nullable().optional().describe('Scheme description'),
  metadata: z.record(z.unknown()).nullable().optional().describe('Extra JSON-LD properties'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
  catalogueId: z.string().describe('Parent catalogue ID'),
});

/** Conformity profile as returned by the API. */
export const conformityProfileSchema = z.object({
  id: z.string().describe('Database ID'),
  canonicalId: z.string().describe('JSON-LD @id from the source document'),
  name: z.string().describe('Profile display name'),
  slug: z.string().describe('URL-friendly identifier derived from the canonical ID'),
  version: z.string().describe('Profile version'),
  status: z.string().describe('Profile status (e.g. Active, Draft)'),
  description: z.string().nullable().optional().describe('Profile description'),
  metadata: z.record(z.unknown()).nullable().optional().describe('Extra JSON-LD properties'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
  schemeId: z.string().describe('Parent scheme ID'),
});

/** Criterion as returned by the API. */
export const criterionSchema = z.object({
  id: z.string().describe('Database ID'),
  canonicalId: z.string().describe('JSON-LD @id from the source document'),
  name: z.string().describe('Criterion display name'),
  version: z.string().describe('Criterion version'),
  status: z.string().describe('Criterion status (e.g. Active, Draft)'),
  description: z.string().nullable().optional().describe('Criterion description'),
  conformityTopic: z.string().nullable().optional().describe('Conformity topic classification'),
  passThreshold: z.record(z.unknown()).nullable().optional().describe('Pass/fail threshold definition'),
  documentation: z.string().nullable().optional().describe('Documentation URL'),
  metadata: z.record(z.unknown()).nullable().optional().describe('Extra JSON-LD properties'),
  createdAt: z.string().datetime().describe('Creation timestamp'),
  updatedAt: z.string().datetime().describe('Last update timestamp'),
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
  hash: z.string(),
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

export const organisationSchema = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  location: z.record(z.unknown()).nullable().describe('UNTP location object'),
  primaryIdentifierId: z.string().nullable(),
  secondaryIdentifierIds: z.array(z.string()).describe('IDs of secondary identifiers'),
  createdAt: z.string().describe('ISO 8601 timestamp'),
  updatedAt: z.string().describe('ISO 8601 timestamp'),
});

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
    CvcValidationWarning: cvcValidationWarningSchema,
    Registrar: registrarSchema,
    SchemeQualifier: schemeQualifierSchema,
    IdentifierScheme: identifierSchemeSchema,
    Identifier: identifierSchema,
    LinkRegistration: linkRegistrationSchema,
    ServiceInstance: serviceInstanceResponseSchema,
    CvcCatalogue: cvcCatalogueSchema,
    CvcImportRequest: cvcImportRequestSchema,
    CvcImportSummary: cvcImportSummarySchema,
    ConformityScheme: conformitySchemeSchema,
    ConformityProfile: conformityProfileSchema,
    Criterion: criterionSchema,
    DataModel: dataModelSchema,
    RenderTemplate: renderTemplateSchema,
    Product: productSchema,
    Organisation: organisationSchema,
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
