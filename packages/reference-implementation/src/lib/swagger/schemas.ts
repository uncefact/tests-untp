/**
 * Zod schemas for API documentation.
 *
 * These schemas mirror the TypeScript types from @uncefact/untp-ri-services
 * and are used to generate OpenAPI schemas for Swagger documentation.
 */

import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';

// ============================================================================
// Credential Schemas
// ============================================================================

/**
 * Identifier scheme describing the registry or system that issued an identifier.
 */
export const identifierSchemeSchema = z.object({
  type: z.array(z.string()).min(1),
  id: z.string(),
  name: z.string(),
});

/**
 * Alternative identity for the issuer, typically a business registration.
 */
export const issuerAlsoKnownAsSchema = z.object({
  id: z.string(),
  name: z.string(),
  registeredId: z.string().optional(),
  idScheme: identifierSchemeSchema.optional(),
});

/**
 * The issuer of a UNTP verifiable credential.
 */
export const credentialIssuerSchema = z.object({
  type: z.array(z.string()).min(1).describe('Type(s) of the issuer'),
  id: z.string().describe('W3C DID of the issuer (did:web or did:webvh)'),
  name: z.string().describe('Human-readable name of the issuer'),
  issuerAlsoKnownAs: z.array(issuerAlsoKnownAsSchema).optional(),
});

/**
 * The subject of a credential.
 */
export const credentialSubjectSchema = z
  .object({
    type: z.array(z.string()).min(1).describe('Type(s) of the credential subject'),
    id: z.string().optional().describe('Optional identifier for the subject'),
  })
  .passthrough();

/**
 * RenderTemplate2024 render method.
 */
export const renderTemplate2024Schema = z.object({
  type: z.literal('RenderTemplate2024'),
  digestMultibase: z.string().describe('Multibase-encoded digest for template integrity verification'),
  name: z.string().optional().describe('Human-readable display name for template selection'),
  template: z.string().optional().describe('Inline template content'),
  url: z.string().url().optional().describe('URL to fetch the template from'),
  mediaType: z.string().optional().describe('Media type of the template'),
});

/**
 * WebRenderingTemplate2022 render method.
 */
export const webRenderingTemplate2022Schema = z.object({
  type: z.literal('WebRenderingTemplate2022'),
  template: z.string().describe('Handlebars template content'),
});

/**
 * Render method for credential display.
 */
export const renderMethodSchema = z.union([renderTemplate2024Schema, webRenderingTemplate2022Schema]);

/**
 * Input payload for issuing a credential.
 */
export const credentialPayloadSchema = z.object({
  '@context': z
    .array(z.string())
    .min(1)
    .describe('JSON-LD context. First element MUST be "https://www.w3.org/ns/credentials/v2"'),
  type: z.array(z.string()).min(1).describe('Credential types. First element MUST be "VerifiableCredential"'),
  issuer: credentialIssuerSchema,
  credentialSubject: z
    .union([credentialSubjectSchema, z.array(credentialSubjectSchema)])
    .describe('The subject(s) of the credential'),
  validUntil: z.string().datetime().optional().describe('Optional validity end date'),
  renderMethod: z.array(renderMethodSchema).optional().describe('Optional render methods for credential display'),
});

// ============================================================================
// DID Schemas
// ============================================================================

/**
 * DID record from the database.
 */
export const didSchema = z.object({
  id: z.string().describe('Database ID of the DID record'),
  did: z.string().describe('The DID identifier (e.g., did:web:example.com)'),
  type: z.enum(['MANAGED', 'SELF_MANAGED']).describe('Type of DID'),
  method: z.enum(['did:web', 'did:key']).describe('DID method'),
  name: z.string().describe('Human-readable name'),
  description: z.string().nullable().describe('Description of the DID'),
  status: z.enum(['ACTIVE', 'UNVERIFIED', 'VERIFIED', 'REVOKED']).describe('Current status of the DID'),
  keyId: z.string().describe('Key identifier associated with the DID'),
  organizationId: z.string().describe('ID of the owning organization'),
  serviceInstanceId: z.string().nullable().describe('ID of the service instance used to manage this DID'),
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
    CredentialPayload: credentialPayloadSchema,
    CredentialIssuer: credentialIssuerSchema,
    CredentialSubject: credentialSubjectSchema,
    IdentifierScheme: identifierSchemeSchema,
    IssuerAlsoKnownAs: issuerAlsoKnownAsSchema,
    RenderMethod: renderMethodSchema,
    RenderTemplate2024: renderTemplate2024Schema,
    WebRenderingTemplate2022: webRenderingTemplate2022Schema,
    Did: didSchema,
    ErrorResponse: errorResponseSchema,
  };

  const openAPISchemas: Record<string, OpenAPISchema> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    const jsonSchema = zodToJsonSchema(schema, {
      target: 'openApi3',
      $refStrategy: 'none',
    });

    // Remove the $schema property as it's not needed in OpenAPI
    const { $schema, ...schemaWithoutMeta } = jsonSchema as Record<string, unknown>;
    openAPISchemas[name] = schemaWithoutMeta as OpenAPISchema;
  }

  return openAPISchemas;
}
