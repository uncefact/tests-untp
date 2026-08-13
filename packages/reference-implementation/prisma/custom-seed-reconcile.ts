import type { Prisma } from '../src/lib/prisma/generated/index.js';
import { RecordSource } from '../src/lib/prisma/generated/index.js';
import type { CustomSeedManifest, ManifestSectionPresence } from './custom-seed-schema.js';

/**
 * Removal phase of the custom-seed reconcile (ADR-033, 2026-08-12 update; #727).
 *
 * The manifest is the source of truth for the rows it owns (`source =
 * CUSTOM_SEED`): a row whose manifest entry has been removed is deleted.
 * Removal is presence-driven — an entity type is only reconciled when its key
 * appears in the raw YAML (see {@link ManifestSectionPresence}) — and scoped
 * so it can never touch `CORE_SEED` or `USER` rows.
 *
 * Deletion whose FK cascade would reach rows the manifest does not own is a
 * hard error ({@link ReconcileBlockedError}), thrown from inside the seed
 * transaction so the whole run rolls back. Blocking cases: any non-manifest
 * identifier scheme under a removed registrar (same-tenant USER rows and other
 * tenants' rows alike), a non-owned qualifier under a removed scheme, a
 * non-owned render template or data-model extension under a removed data
 * model, and registered identifiers (`Identifier.scheme` is `onDelete: Restrict`).
 */
export class ReconcileBlockedError extends Error {
  /** The individual blocking problems, one per affected row, for callers and tests. */
  readonly problems: readonly string[];

  constructor(problems: string[]) {
    super(
      `Custom seed reconcile blocked — removing these manifest entries would affect data the manifest does not own:\n` +
        problems.map((p) => `  - ${p}`).join('\n') +
        `\nKeep the manifest entries, or migrate the blocking data first.`,
    );
    this.name = 'ReconcileBlockedError';
    this.problems = problems;
  }
}

export interface RemovalSummary {
  qualifiers: number;
  identifierSchemes: number;
  registrars: number;
  renderTemplates: number;
  dataModels: number;
}

/**
 * Computes the removal victim closure, runs the non-owned-descendant
 * pre-checks, and executes the deletes child-before-parent. Runs inside the
 * caller's transaction.
 */
export async function reconcileRemovals(
  tx: Prisma.TransactionClient,
  manifest: CustomSeedManifest,
  presence: ManifestSectionPresence,
  systemTenantId: string,
): Promise<RemovalSummary> {
  const problems: string[] = [];

  // ── Victim discovery ───────────────────────────────────────────────────────

  const manifestRegistrarIds = manifest.registrars.map((r) => r.id);

  // Registrars owned by the manifest but no longer declared.
  const registrarVictims = presence.registrars
    ? await tx.registrar.findMany({
        where: { tenantId: systemTenantId, source: RecordSource.CUSTOM_SEED, id: { notIn: manifestRegistrarIds } },
        select: { id: true, name: true },
      })
    : [];
  const registrarVictimIds = registrarVictims.map((r) => r.id);

  // Lock every victim parent row FOR UPDATE before walking its descendants.
  // A child INSERT's foreign-key check takes FOR KEY SHARE on the parent row,
  // which conflicts with FOR UPDATE, so a concurrent request (an old replica
  // still serving during a rolling deploy) attaching a scheme or template to
  // a parent this run is about to delete blocks until this transaction ends,
  // instead of committing into the gap between the descendant check and the
  // delete and being silently cascade-deleted.
  const lockRows = async (table: string, ids: string[]): Promise<void> => {
    if (ids.length === 0) return;
    await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1) FOR UPDATE`, ids);
  };
  await lockRows('Registrar', registrarVictimIds);

  // Identifier schemes removed directly: for each declared registrar whose
  // entry carries an `identifierSchemes` key, owned schemes under it that the
  // entry no longer declares.
  const directSchemeVictimIds: string[] = [];
  for (const registrar of manifest.registrars) {
    if (presence.identifierSchemesByRegistrar.get(registrar.id) !== true) continue;
    const declared = registrar.identifierSchemes.map((s) => s.id);
    const victims = await tx.identifierScheme.findMany({
      where: { registrarId: registrar.id, source: RecordSource.CUSTOM_SEED, id: { notIn: declared } },
      select: { id: true },
    });
    directSchemeVictimIds.push(...victims.map((s) => s.id));
  }

  // Schemes reached by registrar cascade — ALL schemes under a removed
  // registrar, whatever their source or tenant, because the FK cascade does
  // not filter. Non-owned ones block the removal.
  const cascadeSchemes = registrarVictimIds.length
    ? await tx.identifierScheme.findMany({
        where: { registrarId: { in: registrarVictimIds } },
        select: { id: true, name: true, source: true, tenantId: true, registrarId: true },
      })
    : [];
  for (const scheme of cascadeSchemes) {
    if (scheme.source !== RecordSource.CUSTOM_SEED || scheme.tenantId !== systemTenantId) {
      problems.push(
        `registrar "${scheme.registrarId}" (removed from manifest) still has identifier scheme "${scheme.name}" (${scheme.id}, source ${scheme.source}, tenant ${scheme.tenantId}) that the manifest does not own`,
      );
    }
  }

  const allSchemeVictimIds = [...new Set([...directSchemeVictimIds, ...cascadeSchemes.map((s) => s.id)])];
  await lockRows('IdentifierScheme', allSchemeVictimIds);

  // Registered identifiers restrict scheme deletion at the database level; surface
  // them as a named error instead of an aborted transaction.
  if (allSchemeVictimIds.length > 0) {
    const identifierCounts = await tx.identifier.groupBy({
      by: ['schemeId'],
      where: { schemeId: { in: allSchemeVictimIds } },
      _count: { _all: true },
    });
    for (const entry of identifierCounts) {
      problems.push(
        `identifier scheme "${entry.schemeId}" (being removed) has ${entry._count._all} registered identifier(s); re-point or delete them first`,
      );
    }
  }

  // Non-owned qualifiers under any scheme being removed.
  if (allSchemeVictimIds.length > 0) {
    const foreignQualifiers = await tx.schemeQualifier.findMany({
      where: { schemeId: { in: allSchemeVictimIds }, source: { not: RecordSource.CUSTOM_SEED } },
      select: { id: true, key: true, schemeId: true },
    });
    for (const qualifier of foreignQualifiers) {
      problems.push(
        `identifier scheme "${qualifier.schemeId}" (being removed) has qualifier "${qualifier.key}" (${qualifier.id}) that the manifest does not own`,
      );
    }
  }

  // Data model victims and their cascade reach.
  const manifestDataModelIds = manifest.dataModels.map((dm) => dm.id);
  const dataModelVictims = presence.dataModels
    ? await tx.dataModel.findMany({
        where: { tenantId: systemTenantId, source: RecordSource.CUSTOM_SEED, id: { notIn: manifestDataModelIds } },
        select: { id: true, name: true, credentialType: true, version: true },
      })
    : [];
  const dataModelVictimIds = dataModelVictims.map((dm) => dm.id);
  await lockRows('DataModel', dataModelVictimIds);

  if (dataModelVictimIds.length > 0) {
    const foreignTemplates = await tx.renderTemplate.findMany({
      where: { dataModelId: { in: dataModelVictimIds }, source: { not: RecordSource.CUSTOM_SEED } },
      select: { id: true, name: true, dataModelId: true, tenantId: true },
    });
    for (const template of foreignTemplates) {
      problems.push(
        `data model "${template.dataModelId}" (removed from manifest) still has render template "${template.name}" (${template.id}, tenant ${template.tenantId}) that the manifest does not own`,
      );
    }

    const foreignExtensions = await tx.dataModel.findMany({
      where: { parentConfigId: { in: dataModelVictimIds }, source: { not: RecordSource.CUSTOM_SEED } },
      select: { id: true, name: true, parentConfigId: true },
    });
    for (const extension of foreignExtensions) {
      problems.push(
        `data model "${extension.parentConfigId}" (removed from manifest) still has extension "${extension.name}" (${extension.id}) that the manifest does not own`,
      );
    }

    // The ConformityScheme schema binding that ingest resolves by
    // (credentialType, version, isExtension: false) is always a core-seeded
    // row; victims here are CUSTOM_SEED and always extensions, so removing
    // one can never strand a scheme's binding. A unit test pins that scoping.
  }

  if (problems.length > 0) {
    throw new ReconcileBlockedError(problems);
  }

  // ── Deletes, child before parent ───────────────────────────────────────────

  const summary: RemovalSummary = {
    qualifiers: 0,
    identifierSchemes: 0,
    registrars: 0,
    renderTemplates: 0,
    dataModels: 0,
  };

  // Qualifiers dropped from a retained scheme (per-scheme presence).
  for (const registrar of manifest.registrars) {
    for (const scheme of registrar.identifierSchemes) {
      if (presence.qualifiersByScheme.get(scheme.id) !== true) continue;
      const declared = scheme.qualifiers.map((q) => q.id);
      const result = await tx.schemeQualifier.deleteMany({
        where: { schemeId: scheme.id, source: RecordSource.CUSTOM_SEED, id: { notIn: declared } },
      });
      summary.qualifiers += result.count;
    }
  }

  // Schemes dropped from a retained registrar (per-registrar presence). Their
  // qualifiers cascade at the database level and are counted first so the
  // operator log reports every row removed; the pre-checks above guarantee
  // everything reached here is manifest-owned.
  if (directSchemeVictimIds.length > 0) {
    summary.qualifiers += await tx.schemeQualifier.count({ where: { schemeId: { in: directSchemeVictimIds } } });
    const result = await tx.identifierScheme.deleteMany({ where: { id: { in: directSchemeVictimIds } } });
    summary.identifierSchemes += result.count;
  }

  // Registrars removed from the manifest (owned schemes and their qualifiers
  // cascade at the database level). The cascade victims are counted into the
  // summary before the delete, so the operator-facing log reports every row
  // removed rather than only the directly deleted ones; the pre-checks above
  // guarantee everything reached here is manifest-owned.
  if (registrarVictimIds.length > 0) {
    const cascadeSchemeIds = cascadeSchemes.map((s) => s.id).filter((id) => !directSchemeVictimIds.includes(id));
    if (cascadeSchemeIds.length > 0) {
      summary.identifierSchemes += cascadeSchemeIds.length;
      summary.qualifiers += await tx.schemeQualifier.count({ where: { schemeId: { in: cascadeSchemeIds } } });
    }
    const result = await tx.registrar.deleteMany({ where: { id: { in: registrarVictimIds } } });
    summary.registrars += result.count;
  }

  // Render templates removed from the manifest. The stored template object is
  // deliberately retained: credentials already issued against it may still
  // render from it, so storage cleanup stays a manual operator action.
  if (presence.renderTemplates) {
    const result = await tx.renderTemplate.deleteMany({
      where: {
        tenantId: systemTenantId,
        source: RecordSource.CUSTOM_SEED,
        id: { notIn: manifest.renderTemplates.map((rt) => rt.id) },
      },
    });
    summary.renderTemplates += result.count;
  }

  // Data models removed from the manifest. Owned templates and extension rows
  // cascade at the database level; both are counted into the summary before
  // the delete for the same operator-visibility reason as above.
  if (dataModelVictimIds.length > 0) {
    summary.renderTemplates += await tx.renderTemplate.count({ where: { dataModelId: { in: dataModelVictimIds } } });
    summary.dataModels += await tx.dataModel.count({ where: { parentConfigId: { in: dataModelVictimIds } } });
    const result = await tx.dataModel.deleteMany({ where: { id: { in: dataModelVictimIds } } });
    summary.dataModels += result.count;
  }

  return summary;
}
