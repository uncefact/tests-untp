import fs from 'fs';
import path from 'path';
import { parse as parseYaml } from 'yaml';
import { MultibaseDigest } from '@uncefact/untp-utils/multibase-digest';
import type { LoggerService as Logger, ICvcParser } from '@uncefact/untp-ri-services';
import type { PrismaClient, Prisma } from '../src/lib/prisma/generated';
import { RenderMethodType } from '../src/lib/prisma/generated';
import { customSeedSchema, type CustomSeedManifest } from './custom-seed-schema';
import { validateManifestReferences, type ValidationContext } from './custom-seed-validate';
import { buildUpsertOperations } from './custom-seed-upsert';

// ── Constants ────────────────────────────────────────────────────────────────

const TRANSACTION_TIMEOUT = 60_000;
const TRANSACTION_MAX_WAIT = 10_000;
const CVC_FETCH_TIMEOUT = 30_000;
const CVC_MAX_RETRIES = 2;

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
  getCvcParser: (version: string) => ICvcParser | undefined;
  importCatalogue: (input: unknown) => Promise<unknown>;
  supportedCvcVersions: string[];
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
    manifest.cvcCatalogues.length;

  for (const registrar of manifest.registrars) {
    count += registrar.identifierSchemes.length;
    for (const scheme of registrar.identifierSchemes) {
      count += scheme.qualifiers.length;
    }
  }

  return count;
}

/**
 * Fetch JSON from a URL with timeout and retry.
 */
async function fetchWithRetry(
  url: string,
  logger: Logger,
  timeoutMs: number = CVC_FETCH_TIMEOUT,
  maxRetries: number = CVC_MAX_RETRIES,
): Promise<unknown> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: 'application/ld+json' },
      });
      clearTimeout(timer);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.warn(
        { url, attempt, maxRetries, error: lastError.message },
        `CVC catalogue fetch attempt ${attempt}/${maxRetries} failed`,
      );
    }
  }

  throw lastError;
}

// ── Main orchestrator ────────────────────────────────────────────────────────

/**
 * Run the custom seed process: parse YAML manifest, validate, upload templates,
 * fetch CVC catalogues, and upsert all entities in an atomic transaction.
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
  const entityCount = countEntities(manifest);
  if (entityCount === 0) {
    logger.info('Custom seed manifest is empty — nothing to seed');
    return;
  }

  // ── 5. Phase 2 validation (referential integrity) ────────────────────────
  // Build validation context from DB queries.

  const [coreDataModelRows, allDataModelRows] = await Promise.all([
    prisma.dataModel.findMany({ where: { isExtension: false }, select: { id: true } }),
    prisma.dataModel.findMany({ select: { id: true } }),
  ]);

  const coreDataModelIds = new Set(coreDataModelRows.map((r: { id: string }) => r.id));
  const allExistingDataModelIds = new Set(allDataModelRows.map((r: { id: string }) => r.id));

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
  for (const cc of manifest.cvcCatalogues) allManifestIds.push(cc.id);

  // Batch collision detection: find IDs owned by non-system tenants.
  const collisionIds = new Set<string>();

  if (allManifestIds.length > 0) {
    const [
      registrarCollisions,
      dataModelCollisions,
      renderTemplateCollisions,
      identifierSchemeCollisions,
      schemeQualifierCollisions,
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
    ]);

    for (const row of registrarCollisions) collisionIds.add(row.id);
    for (const row of dataModelCollisions) collisionIds.add(row.id);
    for (const row of renderTemplateCollisions) collisionIds.add(row.id);
    for (const row of identifierSchemeCollisions) collisionIds.add(row.id);
    for (const row of schemeQualifierCollisions) collisionIds.add(row.id);
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
    fileExists: (resolvedPath: string) => fs.existsSync(resolvedPath),
    resolvePath: (relativePath: string) => {
      try {
        return fs.realpathSync(path.resolve(mountDir, relativePath));
      } catch {
        return path.resolve(mountDir, relativePath);
      }
    },
    mountDir,
    supportedCvcVersions: deps.supportedCvcVersions,
    isNonSystemCollision: (id: string) => collisionIds.has(id),
  };

  const validationErrors = validateManifestReferences(manifest, validationCtx);
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
        (
          await MultibaseDigest.fromData(new TextEncoder().encode(templateContent), {
            algorithm: 'sha2-256',
            base: 'base58btc',
          })
        ).toString();

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

  // ── 8. External I/O — Fetch CVC catalogues ─────────────────────────────
  const cvcData = new Map<string, unknown>();

  for (const catalogue of ops.cvcCatalogues) {
    try {
      const data = await fetchWithRetry(catalogue.endpointUrl, logger);
      cvcData.set(catalogue.id, data);
    } catch (error) {
      logger.error(
        {
          catalogueId: catalogue.id,
          url: catalogue.endpointUrl,
          error: error instanceof Error ? error.message : error,
        },
        `Failed to fetch CVC catalogue after ${CVC_MAX_RETRIES} attempts`,
      );
      process.exit(1);
    }
  }

  // ── 9. Atomic DB transaction ───────────────────────────────────────────
  await prisma.$transaction(
    async (tx: Prisma.TransactionClient) => {
      // Upsert registrars
      for (const registrar of ops.registrars) {
        await tx.registrar.upsert({
          where: { id: registrar.id },
          update: {
            name: registrar.name,
            namespace: registrar.namespace,
            url: registrar.url,
            idrServiceInstanceId: registrar.idrServiceInstanceId,
          },
          create: {
            id: registrar.id,
            tenantId: registrar.tenantId,
            name: registrar.name,
            namespace: registrar.namespace,
            url: registrar.url,
            idrServiceInstanceId: registrar.idrServiceInstanceId,
          },
        });
      }

      // Upsert identifier schemes
      for (const scheme of ops.identifierSchemes) {
        await tx.identifierScheme.upsert({
          where: { id: scheme.id },
          update: {
            name: scheme.name,
            primaryKey: scheme.primaryKey,
            validationPattern: scheme.validationPattern,
            linkTemplate: scheme.linkTemplate,
          },
          create: {
            id: scheme.id,
            tenantId: scheme.tenantId,
            registrarId: scheme.registrarId,
            name: scheme.name,
            primaryKey: scheme.primaryKey,
            validationPattern: scheme.validationPattern,
            linkTemplate: scheme.linkTemplate,
          },
        });
      }

      // Upsert qualifiers
      for (const qualifier of ops.qualifiers) {
        await tx.schemeQualifier.upsert({
          where: { id: qualifier.id },
          update: {
            key: qualifier.key,
            description: qualifier.description,
            validationPattern: qualifier.validationPattern,
            order: qualifier.order,
          },
          create: {
            id: qualifier.id,
            schemeId: qualifier.schemeId,
            key: qualifier.key,
            description: qualifier.description,
            validationPattern: qualifier.validationPattern,
            order: qualifier.order,
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
          },
        });
      }
    },
    { timeout: TRANSACTION_TIMEOUT, maxWait: TRANSACTION_MAX_WAIT },
  );

  // ── 10. CVC import OUTSIDE transaction ─────────────────────────────────
  // importCatalogue() runs its own internal $transaction, so we call it
  // outside our main transaction to avoid unsupported nested transactions.
  for (const catalogue of ops.cvcCatalogues) {
    const data = cvcData.get(catalogue.id);
    if (!data) continue;

    const parser = deps.getCvcParser(catalogue.version);
    if (!parser) {
      logger.warn(
        { catalogueId: catalogue.id, version: catalogue.version },
        'No CVC parser available for version — skipping import',
      );
      continue;
    }

    // Parse the pre-fetched CVC data using the version-specific parser
    const parsed = parser.parse(data, catalogue.endpointUrl);

    // Use the existing importCatalogue function (full nested persistence)
    const result = await deps.importCatalogue({
      ...parsed,
      tenantId: systemTenantId,
      specVersion: catalogue.version,
    });

    const resultObj = result as Record<string, unknown>;
    const summary = (resultObj?.summary ?? {}) as Record<string, unknown>;
    logger.info({ catalogueId: catalogue.id, ...summary }, 'CVC catalogue imported');
  }

  // ── 11. Log success summary ────────────────────────────────────────────
  const summary = {
    registrars: ops.registrars.length,
    identifierSchemes: ops.identifierSchemes.length,
    qualifiers: ops.qualifiers.length,
    dataModels: ops.dataModels.length,
    renderTemplates: ops.renderTemplates.length,
    cvcCatalogues: ops.cvcCatalogues.length,
  };

  logger.info(summary, 'Custom seed completed successfully');
}
