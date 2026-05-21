import path from 'path';
import { CustomSeedManifest } from './custom-seed-schema.js';

// ── Validation context ────────────────────────────────────────────────────────

export interface ValidationContext {
  /** IDs of core (non-extension) data models in the database */
  coreDataModelIds: Set<string>;
  /** IDs of ALL existing data models in the database (core + extensions) */
  allExistingDataModelIds: Set<string>;
  /** Check if a file exists at the resolved path */
  fileExists: (resolvedPath: string) => boolean;
  /** Resolve a relative path to an absolute path (for traversal detection) */
  resolvePath: (relativePath: string) => string;
  /** The mount directory root */
  mountDir: string;
  /** Check if an ID exists in a non-system tenant (collision) */
  isNonSystemCollision: (id: string) => boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Collect every `id` value appearing anywhere in the manifest and return
 * a set of duplicates (IDs that appear more than once).
 */
function collectDuplicateIds(manifest: CustomSeedManifest): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  const check = (id: string) => {
    if (seen.has(id)) {
      duplicates.add(id);
    } else {
      seen.add(id);
    }
  };

  for (const registrar of manifest.registrars) {
    check(registrar.id);
    for (const scheme of registrar.identifierSchemes) {
      check(scheme.id);
      for (const qualifier of scheme.qualifiers) {
        check(qualifier.id);
      }
    }
  }

  for (const dataModel of manifest.dataModels) {
    check(dataModel.id);
  }

  for (const renderTemplate of manifest.renderTemplates) {
    check(renderTemplate.id);
  }

  return duplicates;
}

// ── Main validation function ──────────────────────────────────────────────────

/**
 * Validate referential integrity and business rules for a parsed manifest.
 *
 * Returns an array of human-readable error messages. An empty array means the
 * manifest is valid.
 *
 * All errors are collected — validation does NOT stop at the first failure.
 */
export function validateManifestReferences(manifest: CustomSeedManifest, ctx: ValidationContext): string[] {
  const errors: string[] = [];

  // ── 1. Duplicate IDs ───────────────────────────────────────────────────────
  const duplicates = collectDuplicateIds(manifest);
  for (const id of duplicates) {
    errors.push(`Duplicate ID detected across manifest entities: "${id}"`);
  }

  // Build a set of data model IDs declared in this manifest for forward-ref checks.
  const manifestDataModelIds = new Set(manifest.dataModels.map((dm) => dm.id));

  // ── 2. Data model validations ──────────────────────────────────────────────
  for (const dataModel of manifest.dataModels) {
    // parentConfigId must reference a core (non-extension) data model in the DB.
    if (!ctx.coreDataModelIds.has(dataModel.parentConfigId)) {
      errors.push(
        `Data model "${dataModel.id}" references unknown parentConfigId "${dataModel.parentConfigId}" (must be a core data model in the database)`,
      );
    }

    // ID collision — exists in a non-system tenant.
    if (ctx.isNonSystemCollision(dataModel.id)) {
      errors.push(`Data model ID "${dataModel.id}" already exists in a non-system tenant and cannot be upserted`);
    }
  }

  // ── 3. Render template validations ────────────────────────────────────────
  // Track (dataModelId → count of isDefault:true) within this manifest.
  const defaultCountByDataModelId = new Map<string, number>();

  for (const template of manifest.renderTemplates) {
    // dataModelId must reference either a manifest data model OR an existing DB data model.
    const knownDataModelId =
      manifestDataModelIds.has(template.dataModelId) || ctx.allExistingDataModelIds.has(template.dataModelId);

    if (!knownDataModelId) {
      errors.push(
        `Render template "${template.id}" references unknown dataModelId "${template.dataModelId}" (not in manifest or database)`,
      );
    }

    // File existence and path traversal checks.
    const resolvedPath = ctx.resolvePath(template.file);

    // Path traversal: resolved path must start with mountDir.
    const normalisedMount = path.normalize(ctx.mountDir);
    const normalisedResolved = path.normalize(resolvedPath);
    if (!normalisedResolved.startsWith(normalisedMount + path.sep) && normalisedResolved !== normalisedMount) {
      errors.push(
        `Render template "${template.id}" file path "${template.file}" resolves outside the mount directory (potential path traversal)`,
      );
    } else if (!ctx.fileExists(resolvedPath)) {
      // Only check file existence when the path is safe.
      errors.push(`Render template "${template.id}" file "${template.file}" does not exist`);
    }

    // isDefault uniqueness within manifest.
    if (template.isDefault) {
      const current = defaultCountByDataModelId.get(template.dataModelId) ?? 0;
      defaultCountByDataModelId.set(template.dataModelId, current + 1);
    }

    // ID collision — exists in a non-system tenant.
    if (ctx.isNonSystemCollision(template.id)) {
      errors.push(`Render template ID "${template.id}" already exists in a non-system tenant and cannot be upserted`);
    }
  }

  for (const [dataModelId, count] of defaultCountByDataModelId) {
    if (count > 1) {
      errors.push(
        `Multiple render templates (${count}) have isDefault: true for dataModelId "${dataModelId}" — only one default is allowed per data model`,
      );
    }
  }

  // ── 4. Registrar ID collision checks ──────────────────────────────────────
  for (const registrar of manifest.registrars) {
    if (ctx.isNonSystemCollision(registrar.id)) {
      errors.push(`Registrar ID "${registrar.id}" already exists in a non-system tenant and cannot be upserted`);
    }

    for (const scheme of registrar.identifierSchemes) {
      if (ctx.isNonSystemCollision(scheme.id)) {
        errors.push(`Identifier scheme ID "${scheme.id}" already exists in a non-system tenant and cannot be upserted`);
      }

      for (const qualifier of scheme.qualifiers) {
        if (ctx.isNonSystemCollision(qualifier.id)) {
          errors.push(`Qualifier ID "${qualifier.id}" already exists in a non-system tenant and cannot be upserted`);
        }
      }
    }
  }

  return errors;
}
