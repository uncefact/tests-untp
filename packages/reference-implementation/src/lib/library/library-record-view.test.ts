import { LibraryRecordOrigin, type Credential, type ExternalCredential, type LibraryRecord } from '../prisma/generated';
import {
  LibraryRecordShapeError,
  narrowExternalRecord,
  narrowLibraryRecord,
  narrowNativeRecord,
  type LibraryRecordWithChildren,
} from './library-record-view';

const record = (origin: LibraryRecordOrigin): LibraryRecord =>
  ({ id: 'rec-1', tenantId: 'tenant-1', origin, credentialType: 'DigitalProductPassport' }) as LibraryRecord;
const credential = { id: 'rec-1', storageUri: 'https://s/x' } as Credential;
const external = { id: 'rec-1', sourceUrl: 'https://supplier.example/a' } as ExternalCredential;

describe('narrowLibraryRecord', () => {
  it('narrows a NATIVE record to its Credential child and drops the relation keys from the parent', () => {
    const row: LibraryRecordWithChildren = {
      ...record(LibraryRecordOrigin.NATIVE),
      credential,
      externalCredential: null,
    };

    const view = narrowLibraryRecord(row);

    expect(view).toEqual({
      origin: LibraryRecordOrigin.NATIVE,
      record: record(LibraryRecordOrigin.NATIVE),
      credential,
    });
    expect(view.record).not.toHaveProperty('credential');
    expect(view.record).not.toHaveProperty('externalCredential');
  });

  it('narrows an EXTERNAL record to its ExternalCredential child', () => {
    const row: LibraryRecordWithChildren = {
      ...record(LibraryRecordOrigin.EXTERNAL),
      credential: null,
      externalCredential: external,
    };

    expect(narrowLibraryRecord(row)).toEqual({
      origin: LibraryRecordOrigin.EXTERNAL,
      record: record(LibraryRecordOrigin.EXTERNAL),
      external,
    });
  });

  it.each<[string, LibraryRecordWithChildren, string]>([
    [
      'a NATIVE record with no child',
      { ...record(LibraryRecordOrigin.NATIVE), credential: null, externalCredential: null },
      'Library record rec-1 is NATIVE but has no child',
    ],
    [
      'an EXTERNAL record with no child',
      { ...record(LibraryRecordOrigin.EXTERNAL), credential: null, externalCredential: null },
      'Library record rec-1 is EXTERNAL but has no child',
    ],
    [
      'a NATIVE record whose only child is external',
      { ...record(LibraryRecordOrigin.NATIVE), credential: null, externalCredential: external },
      'Library record rec-1 is NATIVE but has an ExternalCredential child',
    ],
    [
      'an EXTERNAL record whose only child is native',
      { ...record(LibraryRecordOrigin.EXTERNAL), credential, externalCredential: null },
      'Library record rec-1 is EXTERNAL but has a Credential child',
    ],
    [
      'a NATIVE record with both children',
      { ...record(LibraryRecordOrigin.NATIVE), credential, externalCredential: external },
      'Library record rec-1 is NATIVE but has a Credential child and an ExternalCredential child',
    ],
    [
      'an EXTERNAL record with both children',
      { ...record(LibraryRecordOrigin.EXTERNAL), credential, externalCredential: external },
      'Library record rec-1 is EXTERNAL but has a Credential child and an ExternalCredential child',
    ],
  ])('fails loudly on %s, a shape the database forbids', (_label, row, message) => {
    expect(() => narrowLibraryRecord(row)).toThrow(LibraryRecordShapeError);
    expect(() => narrowLibraryRecord(row)).toThrow(message);
  });

  it('fails loudly on an origin no branch handles, rather than falling through to a child test', () => {
    // The third child table ADR-053 decision 2 anticipates, arriving before
    // this reader has learnt to narrow it. The cast is what the exhaustive
    // switch makes impossible to write by accident.
    const row: LibraryRecordWithChildren = {
      ...record('DOCUMENT' as never),
      credential: null,
      externalCredential: null,
    };

    expect(() => narrowLibraryRecord(row)).toThrow(
      'Library record rec-1 has an origin this reader does not handle: DOCUMENT',
    );
  });
});

describe('narrowExternalRecord', () => {
  it('narrows a record read under an EXTERNAL filter to its child and drops the relation key', () => {
    const view = narrowExternalRecord({ ...record(LibraryRecordOrigin.EXTERNAL), externalCredential: external });

    expect(view).toEqual({
      origin: LibraryRecordOrigin.EXTERNAL,
      record: record(LibraryRecordOrigin.EXTERNAL),
      external,
    });
    expect(view.record).not.toHaveProperty('externalCredential');
  });

  it('fails loudly when the row carries no external child', () => {
    const row = { ...record(LibraryRecordOrigin.EXTERNAL), externalCredential: null };

    expect(() => narrowExternalRecord(row)).toThrow(LibraryRecordShapeError);
    expect(() => narrowExternalRecord(row)).toThrow(
      'Library record rec-1 is EXTERNAL but has no ExternalCredential child',
    );
  });

  it('fails loudly when the read that filtered on EXTERNAL returned another origin', () => {
    const row = { ...record(LibraryRecordOrigin.NATIVE), externalCredential: external };

    expect(() => narrowExternalRecord(row)).toThrow('Library record rec-1 was read as external but is NATIVE');
  });
});

describe('narrowNativeRecord', () => {
  it('narrows a record read under a NATIVE filter to its child and drops the relation key', () => {
    const view = narrowNativeRecord({ ...record(LibraryRecordOrigin.NATIVE), credential });

    expect(view).toEqual({
      origin: LibraryRecordOrigin.NATIVE,
      record: record(LibraryRecordOrigin.NATIVE),
      credential,
    });
    expect(view.record).not.toHaveProperty('credential');
  });

  it('fails loudly when the row carries no native child', () => {
    const row = { ...record(LibraryRecordOrigin.NATIVE), credential: null };

    expect(() => narrowNativeRecord(row)).toThrow(LibraryRecordShapeError);
    expect(() => narrowNativeRecord(row)).toThrow('Library record rec-1 is NATIVE but has no Credential child');
  });

  it('fails loudly when the read that filtered on NATIVE returned another origin', () => {
    const row = { ...record(LibraryRecordOrigin.EXTERNAL), credential };

    expect(() => narrowNativeRecord(row)).toThrow('Library record rec-1 was read as native but is EXTERNAL');
  });
});
