import { CredentialRecordProjectionError } from './credential-record-projection';
import { LibraryRecordShapeError } from './library-record-view';
import {
  LIBRARY_READ_DEGRADATION_REASONS,
  logLibraryReadSummary,
  projectCollectionRead,
  type LibraryReadLogger,
} from './library-read-results';
import type { LibraryRecordDetailView } from './library-record-view';
import type { LibraryRecordHydrationResult } from '@/lib/prisma/repositories/library-record.repository';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function view(id: string): LibraryRecordDetailView {
  return { record: { id } } as unknown as LibraryRecordDetailView;
}

function logger(): LibraryReadLogger & { error: jest.Mock; info: jest.Mock } {
  return { error: jest.fn(), info: jest.fn() };
}

describe('projectCollectionRead', () => {
  it('keeps readable rows in order and reports requested ids with no readable outcome', () => {
    const output = projectCollectionRead(
      {
        data: [view('readable-a')],
        failures: [],
        selectedIds: ['readable-a'],
      },
      {
        orderedIds: ['readable-a', 'missing-b'],
        tenantId: 'tenant-1',
        route: '/api/v1/library/batch-get',
        project: (record) => ({ id: (record.record as { id: string }).id }),
      },
      logger(),
    );

    expect(output).toEqual({
      data: [{ id: 'readable-a' }],
      failures: [{ id: 'missing-b', code: 'NOT_FOUND', message: 'No such credential record.' }],
    });
  });

  it('maps a hydration failure to its parent id and logs one safe degradation event', () => {
    const readLogger = logger();
    const result: LibraryRecordHydrationResult = {
      data: [view('readable-a')],
      failures: [{ id: 'damaged-b', error: new LibraryRecordShapeError('damaged-b', 'has no child') }],
      selectedIds: ['readable-a', 'damaged-b'],
    };

    const output = projectCollectionRead(
      result,
      {
        orderedIds: ['readable-a', 'damaged-b'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: (record) => (record.record as { id: string }).id,
      },
      readLogger,
    );

    expect(output.failures).toEqual([
      {
        id: 'damaged-b',
        code: 'RECORD_UNREADABLE',
        message: expect.stringContaining('damaged-b'),
      },
    ]);
    const [context] = readLogger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(context).toMatchObject({
      recordId: 'damaged-b',
      code: 'RECORD_UNREADABLE',
      readStage: 'hydration',
      reason: 'shape',
    });
    // The error names the record being read, so there is no disagreement to
    // report. Emitting the field anyway would put it on nearly every line and
    // leave an operator comparing two ids to find the rare case where they
    // differ; its presence is meant to be the signal.
    expect(context).not.toHaveProperty('errorRecordId');
  });

  it('keeps the selected parent when a projection error names a different id', () => {
    const readLogger = logger();
    const output = projectCollectionRead(
      { data: [view('parent-a')], failures: [], selectedIds: ['parent-a'] },
      {
        orderedIds: ['parent-a'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: () => {
          throw new CredentialRecordProjectionError('foreign-b', 'date conversion failed');
        },
      },
      readLogger,
    );

    expect(output.failures[0]).toMatchObject({ id: 'parent-a', code: 'RECORD_UNREADABLE' });
    expect(output.failures[0].id).not.toBe('foreign-b');
    expect(readLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'parent-a',
        errorRecordId: 'foreign-b',
        reason: 'identity-mismatch',
      }),
      'Library record read degraded',
    );
  });

  it('reports an identity mismatch when the error names another SELECTED record', () => {
    // Both ids are in the selection, so a classifier that tested membership
    // rather than equality would call this an ordinary projection failure and
    // the operator would never learn that a stored run names the wrong parent.
    const readLogger = logger();
    const output = projectCollectionRead(
      { data: [view('parent-a'), view('parent-b')], failures: [], selectedIds: ['parent-a', 'parent-b'] },
      {
        orderedIds: ['parent-a', 'parent-b'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: (record) => {
          const id = (record.record as { id: string }).id;
          if (id === 'parent-a') throw new CredentialRecordProjectionError('parent-b', 'run names another record');
          return { id };
        },
      },
      readLogger,
    );

    expect(output.data).toEqual([{ id: 'parent-b' }]);
    expect(output.failures).toEqual([
      { id: 'parent-a', code: 'RECORD_UNREADABLE', message: expect.stringContaining('parent-a') },
    ]);
    expect(readLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        recordId: 'parent-a',
        errorRecordId: 'parent-b',
        reason: 'identity-mismatch',
      }),
      'Library record read degraded',
    );
  });

  it('orders failures from both stages by request order rather than by stage', () => {
    // A hydration failure and a projection failure are found at different
    // points in the walk. An implementation that collected the hydration
    // failures in one pass and the projection failures in another would answer
    // [B, A] here, and a caller pairing `failures` against its own request
    // list by position would attribute each failure to the wrong id.
    const readLogger = logger();
    const output = projectCollectionRead(
      {
        data: [view('record-a'), view('record-c')],
        failures: [{ id: 'record-b', error: new LibraryRecordShapeError('record-b', 'has no child') }],
        selectedIds: ['record-a', 'record-b', 'record-c'],
      },
      {
        orderedIds: ['record-a', 'record-b', 'record-c'],
        tenantId: 'tenant-1',
        route: '/api/v1/library/batch-get',
        project: (record) => {
          const id = (record.record as { id: string }).id;
          if (id === 'record-a') throw new CredentialRecordProjectionError('record-a', 'date conversion failed');
          return { id };
        },
      },
      readLogger,
    );

    expect(output.failures.map(({ id }) => id)).toEqual(['record-a', 'record-b']);
    expect(output.data).toEqual([{ id: 'record-c' }]);
    expect(readLogger.error.mock.calls.map(([context]) => (context as { readStage: string }).readStage)).toEqual([
      'projection',
      'hydration',
    ]);
  });

  it('carries the failing error name, message and code into the degradation event', () => {
    // The 200 is the caller's whole answer, so this event is the only place an
    // operator learns which invariant broke. A constant safe detail in its
    // place would leave two differently damaged rows byte-identical here.
    const readLogger = logger();
    projectCollectionRead(
      {
        data: [],
        failures: [{ id: 'damaged-b', error: new LibraryRecordShapeError('damaged-b', 'is EXTERNAL but has no run') }],
        selectedIds: ['damaged-b'],
      },
      {
        orderedIds: ['damaged-b'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: (record) => record,
      },
      readLogger,
    );

    expect(readLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'library.record-shape',
        error: {
          name: 'LibraryRecordShapeError',
          message: 'Library record damaged-b is EXTERNAL but has no run',
        },
      }),
      'Library record read degraded',
    );
  });

  it('carries an unclassified throw as itself rather than as a constant', () => {
    const readLogger = logger();
    projectCollectionRead(
      { data: [view('parent-a')], failures: [], selectedIds: ['parent-a'] },
      {
        orderedIds: ['parent-a'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: () => {
          throw new RangeError('Invalid time value');
        },
      },
      readLogger,
    );

    const [context] = readLogger.error.mock.calls[0] as [Record<string, unknown>, string];
    expect(context).toMatchObject({
      reason: 'unclassified',
      error: { name: 'RangeError', message: 'Invalid time value' },
    });
    expect(context).not.toHaveProperty('errorCode');
    expect(context).not.toHaveProperty('errorRecordId');
  });

  it('turns an unclassified row-local throw into a failure instead of aborting the page', () => {
    const output = projectCollectionRead(
      { data: [view('parent-a')], failures: [], selectedIds: ['parent-a'] },
      {
        orderedIds: ['parent-a'],
        tenantId: 'tenant-1',
        route: '/api/v1/library',
        project: () => {
          throw new Error('toISOString failed');
        },
      },
      logger(),
    );

    expect(output).toMatchObject({ data: [], failures: [{ id: 'parent-a' }] });
  });

  it.each([
    ['an unselected returned row', { data: [view('foreign-b')], failures: [], selectedIds: ['parent-a'] }],
    [
      'a duplicate returned row',
      { data: [view('parent-a'), view('parent-a')], failures: [], selectedIds: ['parent-a'] },
    ],
  ])('keeps %s as a selection-boundary error', (_name, result) => {
    expect(() =>
      projectCollectionRead(
        result,
        {
          orderedIds: ['parent-a'],
          tenantId: 'tenant-1',
          route: '/api/v1/library',
          project: (record) => record,
        },
        logger(),
      ),
    ).toThrow('selection boundary');
  });

  it('rejects duplicate requested ids before producing duplicate outcomes', () => {
    expect(() =>
      projectCollectionRead(
        { data: [view('parent-a')], failures: [], selectedIds: ['parent-a'] },
        {
          orderedIds: ['parent-a', 'parent-a'],
          tenantId: 'tenant-1',
          route: '/api/v1/library/batch-get',
          project: (record) => record,
        },
        logger(),
      ),
    ).toThrow('selection boundary');
  });
});

describe('logLibraryReadSummary', () => {
  it('logs returned, unreadable and not-found counts for one request', () => {
    const readLogger = logger();

    logLibraryReadSummary(readLogger, {
      tenantId: 'tenant-1',
      route: '/api/v1/library/batch-get',
      result: {
        data: [{ id: 'readable-a' }],
        failures: [
          { id: 'damaged-b', code: 'RECORD_UNREADABLE', message: 'Read failed.' },
          { id: 'missing-c', code: 'NOT_FOUND', message: 'No such credential record.' },
        ],
      },
    });

    expect(readLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ returned: 1, unreadable: 1, notFound: 1 }),
      'Library record read summary',
    );
  });
});

/**
 * ADR-057's consequences make the `reason` vocabulary an operator contract:
 * the operations page asks deployments to alert on these values, because the
 * failure no longer arrives as a 5xx. So a value renamed in the code without
 * the documentation, or documented without being emitted, is a broken alert in
 * every deployment that followed that instruction. This holds the two sets
 * equal by reading the published table itself, and the compiler holds the
 * emitted set inside the constant: `logDegradation`, `diagnose` and
 * `logDetailDegradation` all take `LibraryReadDegradationReason`, so a new
 * value has to be added to the constant before it can be emitted at all.
 */
describe('the documented reason vocabulary', () => {
  const LOGGING_DOC = resolve(
    __dirname,
    '../../../../../documentation/docs/reference-implementation/operations/logging.md',
  );

  function documentedReasons(): string[] {
    const doc = readFileSync(LOGGING_DOC, 'utf8');
    const row = doc.split('\n').find((line) => line.startsWith('| `reason`'));
    if (row === undefined) throw new Error(`No \`reason\` row found in ${LOGGING_DOC}`);
    return [...new Set([...row.matchAll(/`([a-z-]+)`/g)].map(([, value]) => value))].filter(
      (value) => value !== 'reason',
    );
  }

  it('documents exactly the reasons the degradation event can carry', () => {
    expect(documentedReasons().sort()).toEqual([...LIBRARY_READ_DEGRADATION_REASONS].sort());
  });
});
