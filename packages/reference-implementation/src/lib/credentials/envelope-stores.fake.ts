/**
 * Test-only: an in-memory EnvelopeStore over a row array, for the suites
 * that exercise the audit, the rotation and the startup validation without
 * a database. Where a test writes, the write mutates the array so the stored
 * value can be read back, with compare-and-swap semantics. Not a test file
 * itself (jest matches `*.test.ts`), and never imported by application code.
 */
import type { CurrentValue, EnvelopeStore, EnvelopeStores, StoredValue } from './envelope-stores';

export type ServiceInstanceRow = { id: string; config: string };
export type KeyRow = { id: string; decryptionKey: string | null };
export type ReplayRow = { id: string; responseBody: string | null };

export type FakeEnvelopeStore = EnvelopeStore & {
  rows: jest.Mock<AsyncGenerator<StoredValue>, []>;
  candidates: jest.Mock<AsyncGenerator<StoredValue>, []>;
  casWrite: jest.Mock<Promise<boolean>, [string, string, string]>;
  discard: jest.Mock<Promise<boolean>, [string, string]>;
  readCurrent: jest.Mock<Promise<CurrentValue>, [string]>;
};

export function fakeStore<Column extends string, R extends { id: string } & Record<Column, string | null>>(
  rows: R[],
  column: Column,
  plaintextAllowed: boolean,
): FakeEnvelopeStore {
  const values = () =>
    rows
      .filter((row) => row[column] !== null)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((row) => ({ id: row.id, value: row[column] as string }));
  async function* each(list: StoredValue[]) {
    yield* list;
  }
  return {
    rows: jest.fn(() => each(values())),
    candidates: jest.fn(() => each(plaintextAllowed ? values().filter((row) => row.value.startsWith('{')) : values())),
    casWrite: jest.fn(async (id: string, expected: string, next: string) => {
      const row = rows.find((r) => r.id === id && r[column] === expected);
      if (!row) return false;
      row[column] = next as R[Column];
      return true;
    }),
    discard: jest.fn(async (id: string, expected: string) => {
      const row = rows.find((r) => r.id === id && r[column] === expected);
      if (!row) return false;
      row[column] = null as R[Column];
      return true;
    }),
    readCurrent: jest.fn(async (id: string): Promise<CurrentValue> => {
      const row = rows.find((r) => r.id === id);
      if (!row) return { kind: 'missing' };
      const value = row[column] as string | null;
      return value === null ? { kind: 'cleared' } : { kind: 'present', value };
    }),
  };
}

/** The four stores over their row arrays, in the port's shape. */
export function fakeStores(
  serviceInstances: ServiceInstanceRow[] = [],
  credentials: KeyRow[] = [],
  replayRows: ReplayRow[] = [],
  externalCredentials: KeyRow[] = [],
): EnvelopeStores & Record<keyof EnvelopeStores, FakeEnvelopeStore> {
  return {
    serviceInstances: fakeStore(serviceInstances, 'config', false),
    credentials: fakeStore(credentials, 'decryptionKey', true),
    externalCredentials: fakeStore(externalCredentials, 'decryptionKey', false),
    idempotencyResponses: fakeStore(replayRows, 'responseBody', false),
  };
}
