/**
 * DID schemas (Zod).
 *
 * This file contains two groups of schemas:
 *
 * 1. **API response schemas** — lightweight shapes used for Swagger / OpenAPI
 *    documentation. These describe the JSON returned by the REST API.
 *
 * 2. **W3C DID Document validation schemas** — stricter shapes used at runtime
 *    to validate DID Documents against the W3C DID Core v1.0 specification.
 *
 * @see https://www.w3.org/TR/did-1.0/
 */

import { z } from 'zod';

// ============================================================================
// API response schemas (Swagger / OpenAPI)
// ============================================================================

/**
 * DID record as returned by the REST API.
 */
export const didResponseSchema = z.object({
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
 * Verification result as returned by the REST API.
 */
export const verificationResultResponseSchema = z.object({
  verified: z.boolean().describe('Whether the DID was successfully verified'),
  message: z.string().describe('Verification result message'),
});

/**
 * Simplified DID Document as returned by the REST API.
 */
export const didDocumentResponseSchema = z.object({
  id: z.string().describe('The DID identifier'),
  verificationMethod: z.array(z.record(z.unknown())).optional().describe('Verification methods (public keys)'),
  authentication: z.array(z.string()).optional().describe('Authentication methods'),
  service: z.array(z.record(z.unknown())).optional().describe('Service endpoints'),
});

// ============================================================================
// W3C DID Document validation schemas
// ============================================================================

/**
 * @todo Define precise DID Document schema per W3C DID Core v1.0.
 * Current schema is a loose subset with .passthrough(). Tighten field
 * requirements, allowed values, and array constraints to match the spec.
 */

export const verificationMethodSchema = z
  .object({
    id: z.string(),
    type: z.string(),
    controller: z.string(),
    publicKeyJwk: z.record(z.unknown()).optional(),
    publicKeyMultibase: z.string().optional(),
  })
  .passthrough();

export const didDocumentSchema = z
  .object({
    '@context': z.union([z.string(), z.array(z.string())]),
    id: z.string(),
    verificationMethod: z.array(verificationMethodSchema).optional(),
    authentication: z.array(z.union([z.string(), verificationMethodSchema])).optional(),
    assertionMethod: z.array(z.union([z.string(), verificationMethodSchema])).optional(),
  })
  .passthrough();
