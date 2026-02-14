/**
 * Zod schemas for API documentation.
 *
 * These schemas are used to generate OpenAPI schemas for Swagger documentation.
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

// ============================================================================
// DID Schemas
// ============================================================================

/**
 * DID record from the database.
 */
export const didSchema = z.object({
  id: z.string().describe('Database ID of the DID record'),
  did: z.string().describe('The DID identifier (e.g., did:web:example.com)'),
  type: z.enum(['DEFAULT', 'MANAGED', 'SELF_MANAGED']).describe('Type of DID'),
  method: z.enum(['DID_WEB', 'DID_WEB_VH']).describe('DID method'),
  name: z.string().describe('Human-readable name'),
  description: z.string().nullable().describe('Description of the DID'),
  status: z.enum(['ACTIVE', 'INACTIVE', 'VERIFIED', 'UNVERIFIED']).describe('Current status of the DID'),
  keyId: z.string().describe('Key identifier associated with the DID'),
  tenantId: z.string().describe('ID of the owning tenant'),
  serviceInstanceId: z.string().nullable().describe('ID of the service instance used to manage this DID'),
  isDefault: z.boolean().describe('Whether this is the default DID for the tenant'),
  createdAt: z.string().datetime().describe('Timestamp when the DID was created'),
  updatedAt: z.string().datetime().describe('Timestamp when the DID was last updated'),
});

/**
 * Error response.
 */
export const errorResponseSchema = z.object({
  ok: z.literal(false),
  error: z.string().describe('Error message'),
});

/**
 * Verification result from DID verification.
 */
export const verificationResultSchema = z.object({
  verified: z.boolean().describe('Whether the DID was successfully verified'),
  message: z.string().describe('Verification result message'),
});

/**
 * DID Document structure.
 */
export const didDocumentSchema = z.object({
  id: z.string().describe('The DID identifier'),
  verificationMethod: z.array(z.record(z.unknown())).optional().describe('Verification methods (public keys)'),
  authentication: z.array(z.string()).optional().describe('Authentication methods'),
  service: z.array(z.record(z.unknown())).optional().describe('Service endpoints'),
});

// ============================================================================
// Credential Schemas
// ============================================================================

/**
 * Storage response after storing a credential.
 */
export const credentialStorageResponseSchema = z.object({
  uri: z.string().describe('URI where the credential is stored'),
  hash: z.string().describe('Hash of the stored credential'),
  decryptionKey: z.string().describe('Key to decrypt the credential'),
});

/**
 * Publish response when publishing a credential.
 */
export const credentialPublishResponseSchema = z.object({
  enabled: z.boolean().describe('Whether publishing was enabled'),
  raw: z.record(z.unknown()).optional().describe('Raw response from the DLR service'),
});

/**
 * Successful credential issue response.
 */
export const credentialIssueResponseSchema = z.object({
  ok: z.literal(true),
  storageResponse: credentialStorageResponseSchema.describe('Storage details for the credential'),
  publishResponse: credentialPublishResponseSchema.describe('Publish status and details'),
  credential: z.record(z.unknown()).describe('The decoded verifiable credential'),
  credentialId: z.string().describe('Database ID of the stored credential record'),
});

/**
 * Request body for issuing a credential.
 */
export const credentialIssueRequestSchema = z.object({
  formData: z.record(z.unknown()).describe('The credential payload'),
  publish: z.boolean().optional().default(false).describe('Whether to publish the credential to the Identity Resolver'),
});

// ============================================================================
// Registrar Schemas
// ============================================================================

/**
 * Registrar record from the database.
 */
export const registrarSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  name: z.string().describe('Human-readable registrar name'),
  namespace: z.string().describe('Namespace identifier for IDR resolution'),
  url: z.string().nullable().describe('Registrar website URL'),
  idrServiceInstanceId: z.string().nullable().describe('Associated IDR service instance'),
  isDefault: z.boolean().describe('Whether this is a system default'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

// ============================================================================
// Identifier Scheme Schemas
// ============================================================================

/**
 * Scheme qualifier definition.
 */
export const schemeQualifierSchema = z.object({
  id: z.string().describe('Database ID'),
  schemeId: z.string().describe('Parent identifier scheme ID'),
  key: z.string().describe('Qualifier key / application identifier code'),
  description: z.string().describe('Human-readable description'),
  validationPattern: z.string().describe('Regex for validating qualifier values'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

/**
 * Identifier scheme record from the database.
 */
export const identifierSchemeSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  registrarId: z.string().describe('Parent registrar ID'),
  name: z.string().describe('Human-readable scheme name'),
  primaryKey: z.string().describe('Primary identifier key per ISO 18975'),
  validationPattern: z.string().describe('Regex for validating identifier values'),
  namespace: z.string().nullable().describe('Optional namespace override'),
  idrServiceInstanceId: z.string().nullable().describe('Associated IDR service instance'),
  isDefault: z.boolean().describe('Whether this is a system default'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

// ============================================================================
// Identifier Schemas
// ============================================================================

/**
 * Identifier record from the database.
 */
export const identifierSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  schemeId: z.string().describe('Parent identifier scheme ID'),
  value: z.string().describe('The identifier value'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

// ============================================================================
// Link Registration Schemas
// ============================================================================

/**
 * Link registration audit record.
 */
export const linkRegistrationSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  identifierId: z.string().describe('Parent identifier ID'),
  idrLinkId: z.string().describe('IDR-assigned link ID'),
  linkType: z.string().describe('Link relation type (e.g. untp:dpp)'),
  targetUrl: z.string().describe('Target URL the link points to'),
  mimeType: z.string().describe('MIME type of the target resource'),
  resolverUri: z.string().describe('Resolver URI for the identifier'),
  qualifierPath: z.string().nullable().describe('Optional qualifier path'),
  publishedAt: z.string().datetime().describe('Timestamp when the link was published'),
});

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
    Did: didSchema,
    ErrorResponse: errorResponseSchema,
    VerificationResult: verificationResultSchema,
    DidDocument: didDocumentSchema,
    CredentialStorageResponse: credentialStorageResponseSchema,
    CredentialPublishResponse: credentialPublishResponseSchema,
    CredentialIssueResponse: credentialIssueResponseSchema,
    CredentialIssueRequest: credentialIssueRequestSchema,
    Registrar: registrarSchema,
    SchemeQualifier: schemeQualifierSchema,
    IdentifierScheme: identifierSchemeSchema,
    Identifier: identifierSchema,
    LinkRegistration: linkRegistrationSchema,
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
