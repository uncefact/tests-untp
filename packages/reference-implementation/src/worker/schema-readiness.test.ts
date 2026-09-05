import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assertSchemaReady, listImageMigrations, prismaMigrationRows } from './schema-readiness';

function migrationsDir(names: string[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrations-'));
  for (const name of names) fs.mkdirSync(path.join(dir, name));
  fs.writeFileSync(path.join(dir, 'migration_lock.toml'), 'provider = "postgresql"\n');
  return dir;
}

const rows = (applied: string[]) => ({ appliedMigrationNames: async () => applied });

describe('listImageMigrations', () => {
  it('lists the migration directories and not the lock file', () => {
    const dir = migrationsDir(['20260306000000_b', '20260306000000_a', '20260901000000_c']);
    expect(listImageMigrations(dir)).toEqual(['20260306000000_a', '20260306000000_b', '20260901000000_c']);
  });

  it('fails the boot by name when the directory holds no migrations at all', () => {
    // An empty set would make the membership check pass vacuously.
    expect(() => listImageMigrations(migrationsDir([]))).toThrow(
      expect.objectContaining({
        code: 'worker.migrations-unreadable',
        message: expect.stringContaining('No migrations'),
      }),
    );
  });

  it('fails the boot by name when the directory cannot be read', () => {
    expect(() => listImageMigrations('/nonexistent/migrations')).toThrow(
      expect.objectContaining({ code: 'worker.migrations-unreadable' }),
    );
  });
});

describe('assertSchemaReady', () => {
  it('passes when every migration the image ships is applied', async () => {
    await expect(assertSchemaReady(rows(['a', 'b']), ['a', 'b'])).resolves.toBeUndefined();
  });

  it('passes when the database is ahead of the image (an older worker beside a newer web)', async () => {
    await expect(assertSchemaReady(rows(['a', 'b', 'c']), ['a', 'b'])).resolves.toBeUndefined();
  });

  it('fails naming a missing migration even when it is not the newest by name', async () => {
    // Two real directories share a timestamp prefix, so a newest-name check
    // would have accepted this database. Fails if the check goes back to
    // comparing maxima.
    await expect(
      assertSchemaReady(rows(['20260306000000_rename', '20260901000000_latest']), [
        '20260306000000_remove',
        '20260306000000_rename',
        '20260901000000_latest',
      ]),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'worker.schema-not-ready',
        message: expect.stringContaining('20260306000000_remove'),
      }),
    );
  });
});

describe('prismaMigrationRows', () => {
  it('counts only finished, not rolled back migrations as applied', async () => {
    const queries: string[] = [];
    const sql = {
      $queryRaw: async <T>(strings: TemplateStringsArray) => {
        queries.push(strings.join('?'));
        return [{ migration_name: 'a' }] as unknown as T;
      },
    };
    await expect(prismaMigrationRows(sql).appliedMigrationNames()).resolves.toEqual(['a']);
    expect(queries[0]).toMatch(/finished_at IS NOT NULL AND rolled_back_at IS NULL/);
  });

  it('names the first-ever boot (no migrations table yet) rather than leaking the raw query error', async () => {
    const sql = {
      $queryRaw: async <T>(): Promise<T> => {
        throw new Error('Raw query failed. Code: `42P01`. Message: `relation "_prisma_migrations" does not exist`');
      },
    };
    await expect(prismaMigrationRows(sql).appliedMigrationNames()).rejects.toThrow(
      expect.objectContaining({
        code: 'worker.schema-not-ready',
        message: expect.stringContaining('no migrations table'),
      }),
    );
  });

  it('lets any other database error through untouched', async () => {
    const sql = {
      $queryRaw: async <T>(): Promise<T> => {
        throw new Error('connection refused');
      },
    };
    await expect(prismaMigrationRows(sql).appliedMigrationNames()).rejects.toThrow('connection refused');
  });
});
