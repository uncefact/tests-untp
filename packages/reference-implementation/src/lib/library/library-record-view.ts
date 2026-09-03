import { LibraryRecordOrigin, type Credential, type ExternalCredential, type LibraryRecord } from '../prisma/generated';

/**
 * A library record read with both of its possible children, as Prisma types
 * the row: each relation optional, so the type admits zero, one or two
 * children. A committed record has exactly one, of the parent's origin
 * (ADR-053 decision 1), and {@link narrowLibraryRecord} is where that rule
 * becomes a type.
 */
export type LibraryRecordWithChildren = LibraryRecord & {
  credential: Credential | null;
  externalCredential: ExternalCredential | null;
};

/**
 * A library record narrowed on its origin: matching on `origin` yields the
 * one child that origin has, so a reader never writes `record.credential!`
 * or an else-branch for a shape the database forbids. `TRecord` is the parent
 * row as the read selected it, with the child relations removed; any other
 * relation the read included stays visible in the type rather than hiding
 * behind the bare parent.
 */
export type NativeRecordView<TRecord = LibraryRecord> = {
  origin: typeof LibraryRecordOrigin.NATIVE;
  record: TRecord;
  credential: Credential;
};
export type ExternalRecordView<TRecord = LibraryRecord> = {
  origin: typeof LibraryRecordOrigin.EXTERNAL;
  record: TRecord;
  external: ExternalCredential;
};
export type LibraryRecordView<TRecord = LibraryRecord> = NativeRecordView<TRecord> | ExternalRecordView<TRecord>;

/**
 * A committed read returned a shape the write paths never produce: a parent
 * with no child, with two, with a child of the other origin, or a record
 * missing a row its write path always creates alongside it. That is a broken
 * invariant, never an empty state, so it fails loudly with the record named.
 * A row read inside the transaction that is creating it is legitimately
 * between those states, so this is only ever raised on committed reads.
 */
export class LibraryRecordShapeError extends Error {
  constructor(recordId: string, detail: string) {
    super(`Library record ${recordId} ${detail}`);
    this.name = 'LibraryRecordShapeError';
  }
}

function childrenFound(credential: Credential | null, external: ExternalCredential | null): string {
  const found = [credential && 'a Credential child', external && 'an ExternalCredential child'].filter(Boolean);
  return found.length > 0 ? found.join(' and ') : 'no child';
}

/** Narrows a record read with both children to the one shape its origin permits. */
export function narrowLibraryRecord<T extends LibraryRecordWithChildren>(
  row: T,
): LibraryRecordView<Omit<T, 'credential' | 'externalCredential'>> {
  const { credential, externalCredential, ...record } = row;
  const origin: LibraryRecordOrigin = row.origin;
  switch (origin) {
    case LibraryRecordOrigin.NATIVE:
      if (credential && !externalCredential) {
        return { origin: LibraryRecordOrigin.NATIVE, record, credential };
      }
      break;
    case LibraryRecordOrigin.EXTERNAL:
      if (externalCredential && !credential) {
        return { origin: LibraryRecordOrigin.EXTERNAL, record, external: externalCredential };
      }
      break;
    default: {
      // A new origin (ADR-053 decision 2 anticipates a third child table) must
      // be handled here before it can be read anywhere.
      const unhandled: never = origin;
      throw new LibraryRecordShapeError(row.id, `has an origin this reader does not handle: ${String(unhandled)}`);
    }
  }
  throw new LibraryRecordShapeError(row.id, `is ${origin} but has ${childrenFound(credential, externalCredential)}`);
}

/**
 * Narrows a record read with only its external child, for a query that
 * already filtered on the origin, so the read fetches no child the composite
 * key forbids and needs no second origin test.
 */
export function narrowExternalRecord<T extends LibraryRecord & { externalCredential: ExternalCredential | null }>(
  row: T,
): ExternalRecordView<Omit<T, 'externalCredential'>> {
  const { externalCredential, ...record } = row;
  if (row.origin !== LibraryRecordOrigin.EXTERNAL) {
    throw new LibraryRecordShapeError(row.id, `was read as external but is ${row.origin}`);
  }
  if (!externalCredential) {
    throw new LibraryRecordShapeError(row.id, 'is EXTERNAL but has no ExternalCredential child');
  }
  return { origin: LibraryRecordOrigin.EXTERNAL, record, external: externalCredential };
}

/** The native counterpart of {@link narrowExternalRecord}. */
export function narrowNativeRecord<T extends LibraryRecord & { credential: Credential | null }>(
  row: T,
): NativeRecordView<Omit<T, 'credential'>> {
  const { credential, ...record } = row;
  if (row.origin !== LibraryRecordOrigin.NATIVE) {
    throw new LibraryRecordShapeError(row.id, `was read as native but is ${row.origin}`);
  }
  if (!credential) {
    throw new LibraryRecordShapeError(row.id, 'is NATIVE but has no Credential child');
  }
  return { origin: LibraryRecordOrigin.NATIVE, record, credential };
}
