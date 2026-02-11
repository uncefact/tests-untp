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
