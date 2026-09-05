import fs from 'node:fs';
import path from 'node:path';
import { WorkerBootError } from './errors';

/** The one query the check needs, so it can be driven by Prisma or by a fake. */
export interface MigrationRows {
  appliedMigrationNames(): Promise<string[]>;
}

/**
 * The migrations this build knows: the directory names under
 * `prisma/migrations`, which is copied wholesale into the image, so the
 * same relative path serves the checkout and `/app`. The lock file is not a
 * migration.
 */
export function listImageMigrations(migrationsDir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(migrationsDir, { withFileTypes: true });
  } catch (error) {
    throw new WorkerBootError(
      'worker.migrations-unreadable',
      `The migrations directory ${migrationsDir} could not be read; the worker cannot tell whether the schema is ready`,
      error,
    );
  }
  const names = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  if (names.length === 0) {
    // An empty directory would make the membership check below pass having
    // compared nothing; this build ships migrations, so none found is a
    // broken image, not a ready schema.
    throw new WorkerBootError(
      'worker.migrations-unreadable',
      `No migrations found under ${migrationsDir}; the worker cannot tell whether the schema is ready`,
    );
  }
  return names;
}

/**
 * The worker never runs migrations (the web container owns them), so before
 * it works a job it requires every migration this build ships to be applied.
 * Membership, not ordering: two directories already share a timestamp prefix
 * (`20260306000000_*`), so "newest name" was never a safe key, and a database
 * that is ahead of the image passes, because an older worker beside a newer
 * web is the rolling window ADR-054 accepts.
 */
export async function assertSchemaReady(rows: MigrationRows, imageMigrations: string[]): Promise<void> {
  const applied = new Set(await rows.appliedMigrationNames());
  const missing = imageMigrations.filter((name) => !applied.has(name));
  if (missing.length > 0) {
    throw new WorkerBootError(
      'worker.schema-not-ready',
      `The database has not applied migration ${missing[0]} (${missing.length} of this build's ${imageMigrations.length} missing); run the web container's migrations first`,
    );
  }
}

/**
 * Applied means finished and not rolled back, the same rule the migration
 * integration suite asserts. A database with no `_prisma_migrations` table at
 * all is the first-ever boot before the web container has migrated, which is
 * the commonest way this check fails, so it gets the named refusal rather
 * than the raw query error.
 */
export function prismaMigrationRows(sql: {
  $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}): MigrationRows {
  return {
    async appliedMigrationNames() {
      try {
        const rows = await sql.$queryRaw<
          { migration_name: string }[]
        >`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
        return rows.map((row) => row.migration_name);
      } catch (error) {
        if (isMissingMigrationsTable(error)) {
          throw new WorkerBootError(
            'worker.schema-not-ready',
            'The database has no migrations table yet; run the web container, which applies them, before the worker',
            error,
          );
        }
        throw error;
      }
    },
  };
}

/** Postgres 42P01 (undefined table), as Prisma surfaces it from a raw query. */
function isMissingMigrationsTable(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /relation "_prisma_migrations" does not exist|42P01/.test(message);
}

/** `prisma/migrations` relative to this file: the same in the checkout and in the image. */
export function defaultMigrationsDir(fromDir: string): string {
  return path.resolve(fromDir, '../../prisma/migrations');
}
