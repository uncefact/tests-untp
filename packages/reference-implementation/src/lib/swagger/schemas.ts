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
  verificationResultResponseSchema,
  didDocumentResponseSchema,
  // IDR schemas
  registrarSchema,
  schemeQualifierSchema,
  identifierSchemeSchema,
  identifierSchema,
  linkRegistrationSchema,
  // Shared schemas
  errorResponseSchema,
} from '@uncefact/untp-ri-services';

// ============================================================================
// Credential Schemas (remain local — no credential service directory yet)
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
// Re-export imported schemas so existing consumers continue to work
// ============================================================================

export {
  didResponseSchema,
  verificationResultResponseSchema,
  didDocumentResponseSchema,
  registrarSchema,
  schemeQualifierSchema,
  identifierSchemeSchema,
  identifierSchema,
  linkRegistrationSchema,
  errorResponseSchema,
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
    DidDocument: didDocumentResponseSchema,
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
