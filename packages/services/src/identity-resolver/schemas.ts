/**
 * API response schemas for identity resolver entities (Swagger / OpenAPI).
 */

import { z } from 'zod';

/**
 * Scheme qualifier definition as returned by the REST API.
 */
export const schemeQualifierSchema = z.object({
  id: z.string().describe('Database ID'),
  schemeId: z.string().describe('Parent identifier scheme ID'),
  key: z.string().describe('Qualifier key / application identifier code'),
  description: z.string().describe('Human-readable description'),
  validationPattern: z.string().describe('Regex for validating qualifier values'),
  // Non-negative, bounded at the top by the int4 range of the underlying
  // Postgres column. Mirrors the non-negative int32 bound used for the
  // request `order` (int32Schema.min(0) in the RI package's
  // request-schemas/shared.ts; not importable here as this package does not
  // depend on the RI package), so keep the two in sync.
  order: z.number().int().min(0).max(2147483647).describe('Qualifier precedence in URI ordering (ascending)'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

/**
 * Identifier scheme's own scalar fields, shared between the top-level
 * `identifierSchemeSchema` and the truncated projection embedded under
 * `registrarSchema.schemes` (`identifierSchemeWithQualifiersSchema` below).
 * A plain field map, not itself a schema: keeps the two projections'
 * scalars from drifting apart without giving either one a name a third
 * domain could mistake for a general-purpose "scheme core".
 */
const schemeScalarFields = {
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  registrarId: z.string().describe('Parent registrar ID'),
  name: z.string().describe('Human-readable scheme name'),
  primaryKey: z.string().describe('Primary identifier key per ISO 18975'),
  validationPattern: z.string().describe('Regex for validating identifier values'),
  linkTemplate: z.string().describe('ISO 18975 link template for URI construction'),
  idrServiceInstanceId: z.string().nullable().describe('Associated IDR service instance'),
};

/**
 * Registrar's own scalar fields, without the nested `schemes` projection.
 * File-private: this is the truncated shape embedded under
 * `identifierSchemeSchema.registrar` and the base `registrarSchema` extends
 * with `schemes`. Do not add a `schemes` field here — `identifierSchemeSchema`
 * reuses this same core for its nested `registrar`, and the identifier-scheme
 * queries that populate it (createIdentifierScheme, getIdentifierSchemeById,
 * updateIdentifierScheme, each `include: { registrar: true }`) never nest
 * schemes on that registrar, so a `schemes` field here would document a value
 * no include ever returns.
 */
const registrarCoreSchema = z.object({
  id: z.string().describe('Database ID'),
  tenantId: z.string().describe('Owning tenant ID'),
  name: z.string().describe('Human-readable registrar name'),
  namespace: z.string().describe('Namespace identifier for IDR resolution'),
  url: z.string().nullable().describe('Registrar website URL'),
  idrServiceInstanceId: z.string().nullable().describe('Associated IDR service instance'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

/**
 * Identifier scheme projection nested under `registrarSchema.schemes`:
 * scalars plus `qualifiers`, no `registrar`, matching getRegistrarById's
 * `include: { schemes: { include: { qualifiers: true } } }`. File-private
 * and named for the exact projection it carries so another domain does not
 * reuse it for a different one; do not add a `registrar` field here — that
 * would recreate the registrar <-> scheme cycle this projection avoids.
 */
const identifierSchemeWithQualifiersSchema = z.object({
  ...schemeScalarFields,
  qualifiers: z.array(schemeQualifierSchema).describe('Qualifier definitions attached to this scheme'),
  createdAt: z.string().datetime().describe('Timestamp when created'),
  updatedAt: z.string().datetime().describe('Timestamp when last updated'),
});

/**
 * Registrar record as returned by the REST API. `schemes` is the truncated
 * per-scheme projection returned by getRegistrarById's nested include
 * (qualifiers, no parent registrar back-reference); it is present only on
 * the single-record detail read (getRegistrarById) and omitted on create,
 * update, and list, none of which carry that include (registrar.repository.ts).
 */
export const registrarSchema = registrarCoreSchema.extend({
  schemes: z
    .array(identifierSchemeWithQualifiersSchema)
    .optional()
    .describe('Schemes registered under this registrar (present on detail reads, omitted on list/create/update)'),
});

/**
 * Identifier scheme record as returned by the REST API. The create, get-by-id,
 * update, and list handlers all include `qualifiers`; create, get-by-id, and
 * update also include `registrar`, but list does not, so `registrar` is
 * marked optional here to match that asymmetry rather than overstating what
 * the list endpoint returns. (The delete handler returns 204 with no body,
 * so it has no bearing on this schema.) The nested `registrar` is the core
 * projection (registrarCoreSchema), never the enriched `registrarSchema`:
 * a scheme's own registrar lookup carries no nested `schemes` back-reference.
 */
export const identifierSchemeSchema = z.object({
  ...schemeScalarFields,
  qualifiers: z.array(schemeQualifierSchema).describe('Qualifier definitions attached to this scheme'),
  registrar: registrarCoreSchema.optional().describe('Parent registrar (omitted on list items)'),
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
