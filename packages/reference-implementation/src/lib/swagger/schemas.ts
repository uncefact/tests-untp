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
import { storageOptionsSchema, publishingOptionsSchema } from '@/lib/api/request-schemas/credential';

// ============================================================================
// Credential Schemas (remain local — no credential service directory yet)
// ============================================================================

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
