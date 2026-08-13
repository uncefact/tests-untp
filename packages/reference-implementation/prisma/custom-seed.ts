import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import type { LoggerService as Logger } from '@uncefact/untp-ri-services';
import type { PrismaClient, Prisma } from '../src/lib/prisma/generated/index.js';
import { ConformitySchemeSource, RecordSource, RenderMethodType } from '../src/lib/prisma/generated/index.js';
import { schemaLoader } from '../src/lib/credentials/schema-loader.js';
import { ingestConformityScheme } from '../src/lib/cvc/index.js';
import {
  customSeedSchema,
  extractSectionPresence,
  type CustomSeedManifest,
  type ManifestSectionPresence,
} from './custom-seed-schema.js';
import { validateManifestReferences, type ValidationContext } from './custom-seed-validate.js';
import { buildUpsertOperations } from './custom-seed-upsert.js';
import { reconcileRemovals, ReconcileBlockedError, type RemovalSummary } from './custom-seed-reconcile.js';

// ── Constants ────────────────────────────────────────────────────────────────

const TRANSACTION_TIMEOUT = 60_000;
const TRANSACTION_MAX_WAIT = 10_000;

// ── Dependencies interface ───────────────────────────────────────────────────

export interface CustomSeedDependencies {
  logger: Logger;
  prisma: PrismaClient;
  systemTenantId: string;
  customSeedDir: string;
  storageService: {
    storeBinary: (
      content: string,
      fileName: string,
      mimeType: string,
    ) => Promise<{
      uri: string;
      digestMultibase?: string;
      externalId?: string;
      bucket?: string;
    }>;
  } | null;
  storageServiceInstanceId: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Count total entities in a parsed manifest.
 */
function countEntities(manifest: CustomSeedManifest): number {
  let count =
    manifest.registrars.length +
    manifest.dataModels.length +
    manifest.renderTemplates.length +
    manifest.conformitySchemes.length;

  for (const registrar of manifest.registrars) {
    count += registrar.identifierSchemes.length;
    for (const scheme of registrar.identifierSchemes) {
      count += scheme.qualifiers.length;
    }
  }

  return count;
}

// ── Conformity scheme seed processing ────────────────────────────────────────

interface ConformitySchemeSeedSummary {
  ingested: number;
  skipped: number;
  failed: number;
  evicted: number;
  criteriaSwept: number;
}

interface ResolvedConformityEntry {
  sourceUrl: string;
  version: string;
  prefetchedBody?: Uint8Array;
}

interface ConformityEntryResolution {
  resolved: ResolvedConformityEntry[];
  /** Kept in step with `fileResolutionFailed`: every branch that increments this for a FILE entry must also set the flag. */
  failed: number;
  /**
   * True when any FILE entry could not be resolved to its identity. Eviction
   * is suppressed for the boot in that case: a transiently unreadable file
   * must never make its previously ingested row look manifest-removed.
   */
  fileResolutionFailed: boolean;
}

/**
 * Resolves every manifest conformity entry to its ownership identity before
 * anything is deleted or ingested. A URL entry's identity is the URL itself
 * (known even if a later fetch fails); a FILE entry's identity is the
 * document's top-level `id`, which requires reading and parsing the file.
 */
function resolveConformityEntries(
  deps: CustomSeedDependencies,
  manifest: CustomSeedManifest,
): ConformityEntryResolution {
  const { logger, customSeedDir } = deps;
  const resolution: ConformityEntryResolution = { resolved: [], failed: 0, fileResolutionFailed: false };

  for (const [index, entry] of manifest.conformitySchemes.entries()) {
    if (entry.url !== undefined) {
      resolution.resolved.push({ sourceUrl: entry.url, version: entry.version });
      continue;
    }
    if (entry.file === undefined) {
      // Unreachable: the manifest schema requires exactly one of `url` or
      // `file` and validation exits before processing. Reaching this means
      // the invariant broke upstream, which must fail the seed, not skip.
      throw new Error(
        `conformitySchemes[${index}] (version "${entry.version}") in ${path.join(
          customSeedDir,
          'seed.yaml',
        )} has neither \`url\` nor \`file\`; the manifest schema should have rejected it`,
      );
    }

    const filePath = path.resolve(customSeedDir, entry.file);
    const normalisedSeedDir = path.normalize(customSeedDir);
    const normalisedFilePath = path.normalize(filePath);
    if (!normalisedFilePath.startsWith(normalisedSeedDir + path.sep) && normalisedFilePath !== normalisedSeedDir) {
      logger.error(
        { file: entry.file, filePath },
        'Conformity scheme seed file path resolves outside the seed directory (potential path traversal); skipping',
      );
      resolution.failed += 1;
      resolution.fileResolutionFailed = true;
      continue;
    }
    if (!fs.existsSync(filePath)) {
      logger.error({ file: entry.file, filePath }, 'Conformity scheme seed file not found; skipping');
      resolution.failed += 1;
      resolution.fileResolutionFailed = true;
      continue;
    }
    const bytes = fs.readFileSync(filePath);
    let doc: { id?: string; '@id'?: string };
    try {
      doc = JSON.parse(bytes.toString('utf-8')) as { id?: string; '@id'?: string };
    } catch (parseErr) {
      logger.error({ file: entry.file, err: parseErr }, 'Conformity scheme seed file is not valid JSON; skipping');
      resolution.failed += 1;
      resolution.fileResolutionFailed = true;
      continue;
    }
    const canonicalId = doc?.id ?? doc?.['@id'];
    if (typeof canonicalId !== 'string' || canonicalId.length === 0) {
      logger.error({ file: entry.file }, 'Conformity scheme seed file missing top-level `id`; skipping');
      resolution.failed += 1;
      resolution.fileResolutionFailed = true;
      continue;
    }
    resolution.resolved.push({ sourceUrl: canonicalId, version: entry.version, prefetchedBody: new Uint8Array(bytes) });
  }

  return resolution;
}

/**
 * Ingests the resolved conformity entries after the main upsert transaction
 * has committed. Each entry is ingested under `tenantId = SYSTEM_TENANT_ID`
 * with `source = SYSTEM_SEED`. Existing rows (matched by `(sourceUrl,
 * tenantId)`) are left untouched — the policy is insert-only-if-absent so
 * that subsequent UNTP discovery or operator updates are preserved. The
 * schema URL is resolved from the core `ConformityScheme` system data-model
 * row keyed by `(credentialType, version, isExtension: false)`.
 */
async function processConformitySchemes(
  deps: CustomSeedDependencies,
  entries: ResolvedConformityEntry[],
  summary: ConformitySchemeSeedSummary,
): Promise<void> {
  const { logger, prisma, systemTenantId } = deps;

  for (const entry of entries) {
    try {
      const existing = await prisma.conformityScheme.findUnique({
        where: { sourceUrl_tenantId: { sourceUrl: entry.sourceUrl, tenantId: systemTenantId } },
      });
      if (existing) {
        logger.info(
          { sourceUrl: entry.sourceUrl },
          'Conformity scheme already present (insert-only-if-absent); skipping',
        );
        summary.skipped += 1;
        continue;
      }

      const dataModel = await prisma.dataModel.findFirst({
        where: {
          tenantId: systemTenantId,
          credentialType: 'ConformityScheme',
          version: entry.version,
          isExtension: false,
        },
      });
      if (!dataModel) {
        logger.error(
          { version: entry.version, sourceUrl: entry.sourceUrl },
          'ConformityScheme DataModel row for this version is not seeded; skipping',
        );
        summary.failed += 1;
        continue;
      }

      const result = await ingestConformityScheme({
        sourceUrl: entry.sourceUrl,
        source: ConformitySchemeSource.SYSTEM_SEED,
        tenantId: systemTenantId,
        conformitySchemaUrl: dataModel.schemaUrl,
        schemaLoader,
        conformityVocabularySpecVersion: entry.version,
        ...(entry.prefetchedBody !== undefined ? { prefetched: { body: entry.prefetchedBody } } : {}),
      });

      if (result.kind === 'success') {
        logger.info({ sourceUrl: entry.sourceUrl, schemeId: result.schemeId }, 'Seeded conformity scheme');
        summary.ingested += 1;
      } else if (result.kind === 'failure') {
        logger.error(
          {
            sourceUrl: entry.sourceUrl,
            version: entry.version,
            status: result.error.status,
            message: result.error.message,
          },
          'Failed to seed conformity scheme',
        );
        summary.failed += 1;
      } else {
        logger.info(
          { sourceUrl: entry.sourceUrl },
          'Conformity scheme reported unchanged on seed; counted as ingested',
        );
        summary.ingested += 1;
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err, sourceUrl: entry.sourceUrl },
        'Unexpected error while seeding conformity scheme; skipping',
      );
      summary.failed += 1;
    }
  }
}

/**
 * Deletes seeded (`SYSTEM_SEED`) conformity schemes whose source URL is no
 * longer declared by the manifest, mirroring the unseen-eviction pass UNTP
 * discovery applies to its own rows. UNTP-discovered and tenant-imported
 * rows are out of scope by the `source` filter. Runs BEFORE ingest so that a
 * document that moved to a new URL while keeping its canonical id frees its
 * `(canonicalId, tenantId)` slot before the new URL's row is created.
 *
 * Deleting a scheme cascades its profiles and their criterion joins;
 * criteria themselves are tenant-shared and cleaned by
 * {@link sweepOrphanCriteria} afterwards.
 */
async function evictUnseenSeededSchemes(deps: CustomSeedDependencies, keepSourceUrls: string[]): Promise<number> {
  const result = await deps.prisma.conformityScheme.deleteMany({
    where: {
      tenantId: deps.systemTenantId,
      source: ConformitySchemeSource.SYSTEM_SEED,
      sourceUrl: { notIn: keepSourceUrls },
    },
  });
  return result.count;
}

/**
 * Deletes system-tenant conformity criteria that no profile references any
 * more. Criteria are shared across schemes within a tenant, so scheme
 * eviction cannot delete them directly; this sweep completes the removal
 * once nothing joins to them. The join FK restricts deletion of a criterion
 * that gains a reference concurrently, so a race can only fail the sweep,
 * never delete a live criterion.
 */
async function sweepOrphanCriteria(deps: CustomSeedDependencies): Promise<number> {
  const result = await deps.prisma.conformityCriterion.deleteMany({
    where: { tenantId: deps.systemTenantId, profiles: { none: {} } },
  });
  return result.count;
}

// ── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run the custom seed process: parse the YAML manifest, validate it, upload
 * template files, then reconcile in one atomic transaction (upserts followed
 * by presence-driven removals, rolled back together on any failure or refusal).
 * Conformity schemes are processed after the transaction commits: entry
 * identities are resolved, unseen seeded rows evicted, entries ingested, and
 * orphaned criteria swept.
 */
export async function runCustomSeed(deps: CustomSeedDependencies): Promise<void> {
  const { logger, prisma, systemTenantId, customSeedDir } = deps;

  // ── 1. Check manifest exists ─────────────────────────────────────────────
  const manifestPath = path.join(customSeedDir, 'seed.yaml');
  if (!fs.existsSync(manifestPath)) {
    logger.info({ manifestPath }, 'No custom seed manifest found — skipping custom seed');
    return;
  }

  // ── 2. Parse YAML ────────────────────────────────────────────────────────
  const rawYaml = fs.readFileSync(manifestPath, 'utf-8');
  let rawData: unknown;
  try {
    rawData = parseYaml(rawYaml);
  } catch (error: unknown) {
    const err = error as Record<string, unknown>;
    const linePos = Array.isArray(err?.linePos) ? (err.linePos as Record<string, unknown>[]) : undefined;
    const line = linePos?.[0]?.line ?? err?.line;
    const col = linePos?.[0]?.col ?? err?.col;
    logger.error({ file: manifestPath, line, col, error: err?.message }, 'Failed to parse custom seed YAML');
    process.exit(1);
  }

  // Which keys the YAML actually contains — captured before Zod defaulting
  // collapses absent and explicitly-empty sections into the same `[]`.
  // Removal is presence-driven: absent key = unmanaged this boot; explicit
  // empty array = remove all manifest-owned rows of that type.
  const presence: ManifestSectionPresence = extractSectionPresence(rawData);

  // ── 3. Phase 1 validation (Zod schema) ───────────────────────────────────
  const parseResult = customSeedSchema.safeParse(rawData);
  if (!parseResult.success) {
    for (const issue of parseResult.error.issues) {
      logger.error(
        { path: issue.path.join('.'), code: issue.code, message: issue.message },
        `Schema validation error: ${issue.message}`,
      );
    }
    process.exit(1);
  }

  const manifest = parseResult.data;

  // ── 4. Empty check ───────────────────────────────────────────────────────
  // Short-circuit only when the manifest carries no section keys at all (an
  // empty or `{}` file). A manifest whose PRESENT keys are all empty is an
  // explicit remove-all instruction and proceeds to the removal phase; the
  // truncated-file case is covered because a partially written file either
  // fails YAML parsing above or parses without the section keys.
  const entityCount = countEntities(manifest);
  const anySectionPresent =
    presence.registrars || presence.dataModels || presence.renderTemplates || presence.conformitySchemes;
  if (entityCount === 0 && !anySectionPresent) {
    logger.info('Custom seed manifest is empty — nothing to seed');
    return;
  }

  // ── 5. Phase 2 validation (referential integrity) ────────────────────────
  // Build validation context from DB queries.

  const [coreDataModelRows, allDataModelRows, customSeedDataModelRows] = await Promise.all([
    prisma.dataModel.findMany({ where: { isExtension: false }, select: { id: true } }),
    prisma.dataModel.findMany({ select: { id: true } }),
    prisma.dataModel.findMany({ where: { source: RecordSource.CUSTOM_SEED }, select: { id: true } }),
  ]);

  const coreDataModelIds = new Set(coreDataModelRows.map((r: { id: string }) => r.id));
  const allExistingDataModelIds = new Set(allDataModelRows.map((r: { id: string }) => r.id));
  const customSeedDataModelIds = new Set(customSeedDataModelRows.map((r: { id: string }) => r.id));

  // Collect all IDs from the manifest for batch collision detection.
  const allManifestIds: string[] = [];
  for (const registrar of manifest.registrars) {
    allManifestIds.push(registrar.id);
    for (const scheme of registrar.identifierSchemes) {
      allManifestIds.push(scheme.id);
      for (const qualifier of scheme.qualifiers) {
        allManifestIds.push(qualifier.id);
      }
    }
  }
  for (const dm of manifest.dataModels) allManifestIds.push(dm.id);
  for (const rt of manifest.renderTemplates) allManifestIds.push(rt.id);

  // Batch collision detection: find IDs owned by non-system tenants, and IDs
  // owned by the core seed (CORE_SEED rows are never claimable by the
  // manifest). System-tenant USER rows with a matching id ARE claimable: they
  // are this manifest's own rows from before provenance tracking existed, and
  // the upsert adopts them by stamping CUSTOM_SEED.
  const collisionIds = new Set<string>();
  const coreSeedCollisionIds = new Set<string>();

  if (allManifestIds.length > 0) {
    const [
      registrarCollisions,
      dataModelCollisions,
      renderTemplateCollisions,
      identifierSchemeCollisions,
      schemeQualifierCollisions,
      coreRegistrars,
      coreDataModels,
      coreRenderTemplates,
      coreIdentifierSchemes,
      coreSchemeQualifiers,
    ] = await Promise.all([
      prisma.registrar.findMany({
        where: { id: { in: allManifestIds }, tenantId: { not: systemTenantId } },
        select: { id: true },
      }),
      prisma.dataModel.findMany({
        where: { id: { in: allManifestIds }, tenantId: { not: systemTenantId } },
        select: { id: true },
      }),
      prisma.renderTemplate.findMany({
        where: { id: { in: allManifestIds }, tenantId: { not: systemTenantId } },
        select: { id: true },
      }),
      prisma.identifierScheme.findMany({
        where: { id: { in: allManifestIds }, tenantId: { not: systemTenantId } },
        select: { id: true },
      }),
      // Qualifiers don't have tenantId directly — check via their scheme's tenant.
      prisma.schemeQualifier.findMany({
        where: {
          id: { in: allManifestIds },
          scheme: { tenantId: { not: systemTenantId } },
        },
        select: { id: true },
      }),
      prisma.registrar.findMany({
        where: { id: { in: allManifestIds }, source: RecordSource.CORE_SEED },
        select: { id: true },
      }),
      prisma.dataModel.findMany({
        where: { id: { in: allManifestIds }, source: RecordSource.CORE_SEED },
        select: { id: true },
      }),
      prisma.renderTemplate.findMany({
        where: { id: { in: allManifestIds }, source: RecordSource.CORE_SEED },
        select: { id: true },
      }),
      prisma.identifierScheme.findMany({
        where: { id: { in: allManifestIds }, source: RecordSource.CORE_SEED },
        select: { id: true },
      }),
      prisma.schemeQualifier.findMany({
        where: { id: { in: allManifestIds }, source: RecordSource.CORE_SEED },
        select: { id: true },
      }),
    ]);

    for (const row of registrarCollisions) collisionIds.add(row.id);
    for (const row of dataModelCollisions) collisionIds.add(row.id);
    for (const row of renderTemplateCollisions) collisionIds.add(row.id);
    for (const row of identifierSchemeCollisions) collisionIds.add(row.id);
    for (const row of schemeQualifierCollisions) collisionIds.add(row.id);
    for (const row of coreRegistrars) coreSeedCollisionIds.add(row.id);
    for (const row of coreDataModels) coreSeedCollisionIds.add(row.id);
    for (const row of coreRenderTemplates) coreSeedCollisionIds.add(row.id);
    for (const row of coreIdentifierSchemes) coreSeedCollisionIds.add(row.id);
    for (const row of coreSchemeQualifiers) coreSeedCollisionIds.add(row.id);
  }

  // Resolve the mount directory — handle non-existent directories gracefully.
  let mountDir: string;
  try {
    mountDir = fs.realpathSync(customSeedDir);
  } catch {
    mountDir = path.resolve(customSeedDir);
  }

  const validationCtx: ValidationContext = {
    coreDataModelIds,
    allExistingDataModelIds,
    customSeedDataModelIds,
    fileExists: (resolvedPath: string) => fs.existsSync(resolvedPath),
    resolvePath: (relativePath: string) => {
      try {
        return fs.realpathSync(path.resolve(mountDir, relativePath));
      } catch {
        return path.resolve(mountDir, relativePath);
      }
    },
    mountDir,
    isNonSystemCollision: (id: string) => collisionIds.has(id),
    isCoreSeedCollision: (id: string) => coreSeedCollisionIds.has(id),
  };

  // Convey adoption before it happens: a system-tenant USER row whose id
  // matches a manifest entry is about to be claimed as CUSTOM_SEED by the
  // upsert (and thereby becomes deletable by future reconciles). Name each
  // adopted row so the operator can see the ownership transfer in the log.
  if (allManifestIds.length > 0) {
    const [adoptedRegistrars, adoptedDataModels, adoptedTemplates, adoptedSchemes, adoptedQualifiers] =
      await Promise.all([
        prisma.registrar.findMany({
          where: { id: { in: allManifestIds }, tenantId: systemTenantId, source: RecordSource.USER },
          select: { id: true, name: true },
        }),
        prisma.dataModel.findMany({
          where: { id: { in: allManifestIds }, tenantId: systemTenantId, source: RecordSource.USER },
          select: { id: true, name: true },
        }),
        prisma.renderTemplate.findMany({
          where: { id: { in: allManifestIds }, tenantId: systemTenantId, source: RecordSource.USER },
          select: { id: true, name: true },
        }),
        prisma.identifierScheme.findMany({
          where: { id: { in: allManifestIds }, tenantId: systemTenantId, source: RecordSource.USER },
          select: { id: true, name: true },
        }),
        prisma.schemeQualifier.findMany({
          where: { id: { in: allManifestIds }, source: RecordSource.USER, scheme: { tenantId: systemTenantId } },
          select: { id: true, key: true },
        }),
      ]);
    const adopted = [
      ...adoptedRegistrars.map((r: { id: string; name: string }) => ({ type: 'registrar', id: r.id, name: r.name })),
      ...adoptedSchemes.map((r: { id: string; name: string }) => ({
        type: 'identifierScheme',
        id: r.id,
        name: r.name,
      })),
      ...adoptedQualifiers.map((r: { id: string; key: string }) => ({ type: 'qualifier', id: r.id, name: r.key })),
      ...adoptedDataModels.map((r: { id: string; name: string }) => ({ type: 'dataModel', id: r.id, name: r.name })),
      ...adoptedTemplates.map((r: { id: string; name: string }) => ({
        type: 'renderTemplate',
        id: r.id,
        name: r.name,
      })),
    ];
    if (adopted.length > 0) {
      logger.warn(
        { adopted },
        'Manifest entries match existing rows not previously manifest-managed; the seed is adopting them (they become manifest-owned and deletable by future reconciles)',
      );
    }
  }

  const validationErrors = validateManifestReferences(manifest, validationCtx, presence);
  if (validationErrors.length > 0) {
    for (const error of validationErrors) {
      logger.error({ error }, `Validation error: ${error}`);
    }
    process.exit(1);
  }

  // ── 6. Build upsert operations ──────────────────────────────────────────
  const ops = buildUpsertOperations(manifest, systemTenantId);

  // ── 7. External I/O — Upload render templates ───────────────────────────
  interface TemplateStorageResult {
    templateId: string;
    storageUrl: string;
    digestMultibase: string;
    externalId?: string;
    bucket?: string;
    contentType: string;
  }

  const templateResults: TemplateStorageResult[] = [];

  if (ops.renderTemplates.length > 0) {
    if (!deps.storageService) {
      logger.error('Render templates require a storage service but none is available');
      process.exit(1);
    }

    for (const template of ops.renderTemplates) {
      const resolvedPath = validationCtx.resolvePath(template.file);
      const templateContent = fs.readFileSync(resolvedPath, 'utf-8');
      const fileName = path.basename(template.file);

      const storageRecord = await deps.storageService.storeBinary(templateContent, fileName, 'text/html');

      const digestMultibase =
        storageRecord.digestMultibase ??
        (await MultibaseDigest.fromText(templateContent, { algorithm: 'sha2-256', base: 'base58btc' })).toString();

      templateResults.push({
        templateId: template.id,
        storageUrl: storageRecord.uri,
        digestMultibase,
        externalId: storageRecord.externalId,
        bucket: storageRecord.bucket,
        contentType: 'text/html',
      });
    }
  }

  // ── 8. Atomic DB transaction ───────────────────────────────────────────
  let removalSummary: RemovalSummary = {
    qualifiers: 0,
    identifierSchemes: 0,
    registrars: 0,
    renderTemplates: 0,
    dataModels: 0,
  };
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Upsert registrars. Updates stamp `source: CUSTOM_SEED` so the
      // manifest claims (or re-claims) ownership of the rows it manages;
      // core-seed collisions were rejected during validation, so a claimed
      // row is either already manifest-owned or a pre-provenance legacy row.
      for (const registrar of ops.registrars) {
        await tx.registrar.upsert({
          where: { id: registrar.id },
          update: {
            name: registrar.name,
            namespace: registrar.namespace,
            url: registrar.url,
            idrServiceInstanceId: registrar.idrServiceInstanceId,
            source: RecordSource.CUSTOM_SEED,
          },
          create: {
            id: registrar.id,
            tenantId: registrar.tenantId,
            name: registrar.name,
            namespace: registrar.namespace,
            url: registrar.url,
            idrServiceInstanceId: registrar.idrServiceInstanceId,
            source: RecordSource.CUSTOM_SEED,
          },
        });
      }

      // Upsert identifier schemes. `registrarId` is part of the update so a
      // scheme moved between registrars in the manifest is re-attached rather
      // than left behind for its old parent's cascade to delete.
      for (const scheme of ops.identifierSchemes) {
        await tx.identifierScheme.upsert({
          where: { id: scheme.id },
          update: {
            registrarId: scheme.registrarId,
            name: scheme.name,
            primaryKey: scheme.primaryKey,
            validationPattern: scheme.validationPattern,
            linkTemplate: scheme.linkTemplate,
            source: RecordSource.CUSTOM_SEED,
          },
          create: {
            id: scheme.id,
            tenantId: scheme.tenantId,
            registrarId: scheme.registrarId,
            name: scheme.name,
            primaryKey: scheme.primaryKey,
            validationPattern: scheme.validationPattern,
            linkTemplate: scheme.linkTemplate,
            source: RecordSource.CUSTOM_SEED,
          },
        });
      }

      // Upsert qualifiers. `schemeId` is part of the update for the same
      // reparenting reason as identifier schemes above.
      for (const qualifier of ops.qualifiers) {
        await tx.schemeQualifier.upsert({
          where: { id: qualifier.id },
          update: {
            schemeId: qualifier.schemeId,
            key: qualifier.key,
            description: qualifier.description,
            validationPattern: qualifier.validationPattern,
            order: qualifier.order,
            source: RecordSource.CUSTOM_SEED,
          },
          create: {
            id: qualifier.id,
            schemeId: qualifier.schemeId,
            key: qualifier.key,
            description: qualifier.description,
            validationPattern: qualifier.validationPattern,
            order: qualifier.order,
            source: RecordSource.CUSTOM_SEED,
          },
        });
      }

      // Upsert data models (as extensions)
      for (const dataModel of ops.dataModels) {
        await tx.dataModel.upsert({
          where: { id: dataModel.id },
          update: {
            name: dataModel.name,
            credentialType: dataModel.credentialType,
            version: dataModel.version,
            isExtension: true,
            parentConfigId: dataModel.parentConfigId,
            schemaUrl: dataModel.schemaUrl,
            contextUrl: dataModel.contextUrl,
            websiteUrl: dataModel.websiteUrl,
            source: RecordSource.CUSTOM_SEED,
          },
          create: {
            id: dataModel.id,
            tenantId: dataModel.tenantId,
            name: dataModel.name,
            credentialType: dataModel.credentialType,
            version: dataModel.version,
            isExtension: true,
            parentConfigId: dataModel.parentConfigId,
            schemaUrl: dataModel.schemaUrl,
            contextUrl: dataModel.contextUrl,
            websiteUrl: dataModel.websiteUrl,
            source: RecordSource.CUSTOM_SEED,
          },
        });
      }

      // Upsert render templates (with storage metadata from step 7)
      for (const template of ops.renderTemplates) {
        const storageResult = templateResults.find((r) => r.templateId === template.id);
        if (!storageResult) continue; // Should not happen — templates were uploaded in step 7.

        await tx.renderTemplate.upsert({
          where: { id: template.id },
          update: {
            name: template.name,
            dataModelId: template.dataModelId,
            storageUrl: storageResult.storageUrl,
            digestMultibase: storageResult.digestMultibase,
            isDefault: template.isDefault,
            renderMethodType: template.renderMethodType as RenderMethodType,
            inline: template.inline,
            mediaType: template.mediaType,
            mediaQuery: template.mediaQuery,
            storageServiceInstanceId: deps.storageServiceInstanceId,
            storageExternalId: storageResult.externalId,
            storageBucket: storageResult.bucket,
            storageContentType: storageResult.contentType,
            source: RecordSource.CUSTOM_SEED,
          },
          create: {
            id: template.id,
            tenantId: template.tenantId,
            name: template.name,
            dataModelId: template.dataModelId,
            storageUrl: storageResult.storageUrl,
            digestMultibase: storageResult.digestMultibase,
            isDefault: template.isDefault,
            renderMethodType: template.renderMethodType as RenderMethodType,
            inline: template.inline,
            mediaType: template.mediaType,
            mediaQuery: template.mediaQuery,
            storageServiceInstanceId: deps.storageServiceInstanceId,
            storageExternalId: storageResult.externalId,
            storageBucket: storageResult.bucket,
            storageContentType: storageResult.contentType,
            source: RecordSource.CUSTOM_SEED,
          },
        });
      }

      // Removal phase: delete manifest-owned rows whose entries are gone.
      // Runs after the upserts (so reparented children are re-attached before
      // their old parent is considered) and inside the same transaction, so a
      // blocked removal rolls back the whole run. Throws ReconcileBlockedError
      // when a deletion would cascade into rows the manifest does not own;
      // the outer catch in seed.ts logs it and exits non-zero.
      removalSummary = await reconcileRemovals(tx, manifest, presence, systemTenantId).catch((err: unknown) => {
        if (err instanceof ReconcileBlockedError) throw err;
        throw new Error('Custom seed removal phase failed', { cause: err });
      });
      logger.info({ ...removalSummary }, 'Custom seed removal phase complete');
    },
    { timeout: TRANSACTION_TIMEOUT, maxWait: TRANSACTION_MAX_WAIT },
  );

  // ── 9. Reconcile and ingest conformity schemes (post-transaction) ─────
  // Each ingest manages its own transaction internally; run after the main
  // commit so failures here don't roll back the upserts above. Order within
  // the pass: resolve every entry's identity first, then evict unseen seeded
  // rows, then ingest, then sweep orphaned criteria. Eviction only runs when
  // the manifest carries the `conformitySchemes` key AND every FILE entry
  // resolved — a transiently unreadable file suppresses eviction for the
  // boot rather than deleting a previously good row.
  const conformitySummary: ConformitySchemeSeedSummary = {
    ingested: 0,
    skipped: 0,
    failed: 0,
    evicted: 0,
    criteriaSwept: 0,
  };

  if (presence.conformitySchemes || manifest.conformitySchemes.length > 0) {
    const resolution = resolveConformityEntries(deps, manifest);
    conformitySummary.failed += resolution.failed;

    if (presence.conformitySchemes) {
      if (resolution.fileResolutionFailed) {
        logger.error(
          { failedEntries: resolution.failed },
          'One or more conformity scheme file entries could not be resolved; skipping seeded-scheme eviction this boot (reconciliation incomplete)',
        );
      } else {
        conformitySummary.evicted = await evictUnseenSeededSchemes(
          deps,
          resolution.resolved.map((entry) => entry.sourceUrl),
        ).catch((err: unknown) => {
          throw new Error('Seeded conformity scheme eviction failed', { cause: err });
        });
      }
    }

    await processConformitySchemes(deps, resolution.resolved, conformitySummary);

    if (presence.conformitySchemes && !resolution.fileResolutionFailed) {
      conformitySummary.criteriaSwept = await sweepOrphanCriteria(deps).catch((err: unknown) => {
        throw new Error('Orphan criterion sweep failed', { cause: err });
      });
    }
  }

  // ── 10. Log success summary ───────────────────────────────────────────
  const summary = {
    upserted: {
      registrars: ops.registrars.length,
      identifierSchemes: ops.identifierSchemes.length,
      qualifiers: ops.qualifiers.length,
      dataModels: ops.dataModels.length,
      renderTemplates: ops.renderTemplates.length,
    },
    removed: removalSummary,
    conformitySchemes: conformitySummary,
  };

  logger.info(summary, 'Custom seed completed successfully');
}
