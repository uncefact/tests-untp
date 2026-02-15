/**
 * API response schemas for identity resolver entities (Swagger / OpenAPI).
 */

import { z } from 'zod';

/**
 * Registrar record as returned by the REST API.
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

/**
 * Scheme qualifier definition as returned by the REST API.
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
 * Identifier scheme record as returned by the REST API.
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

/**
 * Identifier record as returned by the REST API.
 */
export const identifierSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  schemeId: z.string().describe('Parent identifier scheme ID'),
  value: z.string().describe('The identifier value'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

/**
 * Link registration audit record as returned by the REST API.
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
