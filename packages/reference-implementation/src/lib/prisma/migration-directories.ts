import fs from 'node:fs';

/**
 * The migration directory names under a `prisma/migrations` tree, sorted.
 * Prisma names them with a leading timestamp, so the sort is the order they
 * are applied in and a lexical comparison answers "after this one".
 *
 * Reading a directory of names, and nothing else: the worker's boot check
 * wraps this with the failures a broken image must report, and callers that
 * only need the list take it from here without those.
 */
export function listMigrationDirectories(migrationsDir: string): string[] {
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
