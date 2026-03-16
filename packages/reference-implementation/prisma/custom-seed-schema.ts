import { z } from 'zod';

// ── Qualifier schema ──────────────────────────────────────────────────────────

export const customSeedQualifierSchema = z.object({
  /** CUID v1 — must match the Prisma-generated primary key format. */
  id: z.string().cuid(),
  /** The qualifier key, e.g. "10" for GS1 batch number. */
  key: z.string(),
  /** Human-readable description of the qualifier. */
  description: z.string(),
  /** Regex used to validate qualifier values. */
  validationPattern: z.string(),
  /**
   * Qualifier precedence in the URI (ascending).
   * Defaults to 0 when omitted or explicitly null.
   */
  order: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((v) => v ?? 0),
});

export type CustomSeedQualifier = z.infer<typeof customSeedQualifierSchema>;

// ── Identifier scheme schema ──────────────────────────────────────────────────

export const customSeedIdentifierSchemeSchema = z.object({
  /** CUID v1 primary key. */
  id: z.string().cuid(),
  /** Human-readable name, e.g. "GS1 Global Trade Item Number". */
  name: z.string(),
  /** The primary key segment, e.g. "01" for GTIN. */
  primaryKey: z.string(),
  /** Regex used to validate primary identifier values. */
  validationPattern: z.string(),
  /** ISO 18975 link template, e.g. "/{primaryKey}/{value}". */
  linkTemplate: z.string(),
  /** Qualifier definitions attached to this scheme. Defaults to [] when omitted or null. */
  qualifiers: customSeedQualifierSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),
});

export type CustomSeedIdentifierScheme = z.infer<typeof customSeedIdentifierSchemeSchema>;

// ── Registrar schema ──────────────────────────────────────────────────────────

export const customSeedRegistrarSchema = z.object({
  /** CUID v1 primary key. */
  id: z.string().cuid(),
  /** Human-readable name, e.g. "GS1". */
  name: z.string(),
  /** Short namespace slug, e.g. "gs1". */
  namespace: z.string(),
  /** Optional URL for the registrar's website. */
  url: z.string().url().nullish(),
  /** CUID v1 reference to an IDR service instance. */
  idrServiceInstanceId: z.string().cuid().nullish(),
  /** Identifier schemes operated by this registrar. Defaults to [] when omitted or null. */
  identifierSchemes: customSeedIdentifierSchemeSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),
});

export type CustomSeedRegistrar = z.infer<typeof customSeedRegistrarSchema>;

// ── Data model schema ─────────────────────────────────────────────────────────

export const customSeedDataModelSchema = z.object({
  /** CUID v1 primary key. */
  id: z.string().cuid(),
  /** Human-readable name, e.g. "Digital Product Passport v0.6.0". */
  name: z.string(),
  /** Credential type identifier, e.g. "DigitalProductPassport". */
  credentialType: z.string(),
  /** Semantic version string, e.g. "0.6.0". */
  version: z.string(),
  /** CUID v1 reference to the parent core data model config. */
  parentConfigId: z.string().cuid(),
  /** URL pointing to the JSON Schema for this data model. */
  schemaUrl: z.string().url(),
  /** URL pointing to the JSON-LD context for this data model. */
  contextUrl: z.string().url(),
  /** Optional URL for the specification website. */
  websiteUrl: z.string().url().nullish(),
});

export type CustomSeedDataModel = z.infer<typeof customSeedDataModelSchema>;

// ── Render template schema ────────────────────────────────────────────────────

/**
 * Render method type enum matching the Prisma RenderMethodType enum values.
 */
export const renderMethodTypeEnum = z.enum(['RenderTemplate2024', 'WebRenderingTemplate2022']);

export const customSeedRenderTemplateSchema = z.object({
  /** CUID v1 primary key. */
  id: z.string().cuid(),
  /** Human-readable name, e.g. "DPP Default Template". */
  name: z.string(),
  /** Relative path to the template file (e.g. .hbs file) within the seed. */
  file: z.string(),
  /** CUID v1 reference to the associated data model. */
  dataModelId: z.string().cuid(),
  /** Render method type discriminator. */
  renderMethodType: renderMethodTypeEnum,
  /**
   * Whether this template is the tenant default for the data model.
   * Defaults to false when omitted or explicitly null.
   */
  isDefault: z
    .boolean()
    .nullish()
    .transform((v) => v ?? false),
  /** Whether the template should be inlined into the credential. */
  inline: z.boolean().nullish(),
  /** MIME type of the rendered output, e.g. "text/html". */
  mediaType: z.string().nullish(),
  /** CSS media query string for responsive rendering. */
  mediaQuery: z.string().nullish(),
});

export type CustomSeedRenderTemplate = z.infer<typeof customSeedRenderTemplateSchema>;

// ── CVC catalogue schema ──────────────────────────────────────────────────────

export const customSeedCvcCatalogueSchema = z.object({
  /** CUID v1 primary key. */
  id: z.string().cuid(),
  /** Human-readable name for the catalogue. */
  name: z.string(),
  /** Catalogue version string. */
  version: z.string(),
  /** URL of the remote CVC JSON-LD endpoint. */
  endpointUrl: z.string().url(),
});

export type CustomSeedCvcCatalogue = z.infer<typeof customSeedCvcCatalogueSchema>;

// ── Root manifest schema ──────────────────────────────────────────────────────

/**
 * Zod schema for the custom seed manifest (`seed.yaml`).
 *
 * All top-level arrays are optional and default to `[]` so that an empty
 * (or minimal) manifest is always valid.
 */
export const customSeedSchema = z.object({
  /** Registrars to upsert, each optionally containing identifier schemes and qualifiers. */
  registrars: customSeedRegistrarSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),

  /** Data model extension configs to upsert. */
  dataModels: customSeedDataModelSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),

  /** Render templates to upsert (template files are read from disk via the `file` path). */
  renderTemplates: customSeedRenderTemplateSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),

  /** CVC catalogues to import from remote endpoints. */
  cvcCatalogues: customSeedCvcCatalogueSchema
    .array()
    .nullish()
    .transform((v) => v ?? []),
});

export type CustomSeedManifest = z.infer<typeof customSeedSchema>;
