import {
  CheckResult,
  CheckRunFailureCode,
  CheckRunState,
  CoreCredentialType,
  CredentialDetailsError,
  CredentialDetailsStatus,
  ExternalContentKind,
  LibraryRecordOrigin,
  type CheckRun,
  type ExternalCredential,
  type LibraryRecord,
} from '@/lib/prisma/generated';
import type { ExternalCredentialRecord } from '@/lib/prisma/repositories/external-credential.repository';
import {
  BLOCKING_CHECKS,
  CredentialRecordProjectionError,
  credentialRecordSchema,
  deriveCompleteSummary,
  deriveCurrencyStatus,
  toCredentialRecord,
  verificationEnvelopeSchema,
  type VerificationChecks,
} from './credential-record-projection';

const NOW = new Date('2026-09-03T12:00:00.000Z');

function checks(overrides: Partial<VerificationChecks> = {}): VerificationChecks {
  return {
    retrieval: 'not_run',
    decryption: 'not_run',
    digest: 'not_run',
    proof: 'not_run',
    status: 'not_run',
    temporal: 'not_run',
    schemaConformance: 'not_run',
    ...overrides,
  };
}

function parent(overrides: Partial<LibraryRecord> = {}): LibraryRecord {
  return {
    id: 'crec0000000000000000000001',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    name: null,
    issuerName: null,
    issuerDid: null,
    subjectName: null,
    subjectId: null,
    validFrom: null,
    validUntil: null,
    credentialType: null,
    coreCredentialType: null,
    coreDataModelVersion: null,
    detailsStatus: CredentialDetailsStatus.EXTRACTION_PENDING,
    detailsError: null,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:05.000Z'),
    ...overrides,
  };
}

function external(overrides: Partial<ExternalCredential> = {}): ExternalCredential {
  return {
    id: 'crec0000000000000000000001',
    tenantId: 'tenant-1',
    origin: LibraryRecordOrigin.EXTERNAL,
    sourceUrl: 'https://supplier.example/credential-a',
    sourceDigest: null,
    encrypted: null,
    contentKind: null,
    storageUri: null,
    storageDigestMultibase: null,
    storageServiceInstanceId: null,
    storageExternalId: null,
    storageBucket: null,
    decryptionKey: null,
    displayName: 'Supplier DCC',
    declaredCredentialType: CoreCredentialType.DCC,
    dateReceived: null,
    notes: null,
    annotationVersion: 1,
    decryptionKeyUnused: false,
    createdAt: new Date('2026-09-03T11:00:00.000Z'),
    updatedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function run(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 'crun0000000000000000000001',
    recordId: 'crec0000000000000000000001',
    tenantId: 'tenant-1',
    generation: 1,
    state: CheckRunState.PENDING,
    retrieval: CheckResult.PASS,
    decryption: CheckResult.NOT_RUN,
    digest: CheckResult.PASS,
    proof: CheckResult.NOT_RUN,
    status: CheckResult.NOT_RUN,
    temporal: CheckResult.NOT_RUN,
    schemaConformance: CheckResult.NOT_RUN,
    failureCode: null,
    failureMessage: null,
    failureRetryable: null,
    requestedAt: new Date('2026-09-03T11:00:00.000Z'),
    completedAt: null,
    lastEnqueuedAt: new Date('2026-09-03T11:00:00.000Z'),
    ...overrides,
  };
}

function record(
  overrides: {
    parent?: Partial<LibraryRecord>;
    external?: Partial<ExternalCredential>;
    run?: Partial<CheckRun>;
  } = {},
): ExternalCredentialRecord {
  return {
    origin: LibraryRecordOrigin.EXTERNAL,
    record: parent(overrides.parent),
    external: external(overrides.external),
    checkRun: run(overrides.run),
  };
}

describe('deriveCompleteSummary', () => {
  it('names exactly the five blocking checks', () => {
    expect([...BLOCKING_CHECKS]).toEqual(['retrieval', 'decryption', 'digest', 'proof', 'status']);
  });

  it('is verified when every blocking check that ran passed and at least one ran', () => {
    expect(deriveCompleteSummary(checks({ retrieval: 'pass', digest: 'pass', proof: 'pass', status: 'pass' }))).toBe(
      'verified',
    );
    expect(deriveCompleteSummary(checks({ proof: 'pass' }))).toBe('verified');
  });

  it.each(BLOCKING_CHECKS)('is not_conformant when %s fails, whatever else passed', (name) => {
    const all = checks({ retrieval: 'pass', decryption: 'pass', digest: 'pass', proof: 'pass', status: 'pass' });
    expect(deriveCompleteSummary({ ...all, [name]: 'fail' })).toBe('not_conformant');
  });

  it('never reads an all-not_run blocking set as verified', () => {
    expect(deriveCompleteSummary(checks())).toBe('not_conformant');
    expect(deriveCompleteSummary(checks({ temporal: 'pass', schemaConformance: 'pass' }))).toBe('not_conformant');
  });

  it('lets temporal and schemaConformance fail without changing a verified summary', () => {
    const all = checks({ retrieval: 'pass', decryption: 'pass', digest: 'pass', proof: 'pass', status: 'pass' });
    expect(deriveCompleteSummary({ ...all, temporal: 'fail', schemaConformance: 'fail' })).toBe('verified');
  });
});

describe('verificationEnvelopeSchema', () => {
  const base = { generation: 1, requestedAt: '2026-09-03T11:00:00.000Z', checks: checks({ proof: 'pass' }) };

  it('accepts each settlement variant in its legal shape', () => {
    expect(verificationEnvelopeSchema.safeParse({ ...base, state: 'pending', summary: 'pending' }).success).toBe(true);
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'complete',
        completedAt: '2026-09-03T11:00:05.000Z',
        summary: 'verified',
      }).success,
    ).toBe(true);
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'failed',
        completedAt: '2026-09-03T11:00:05.000Z',
        summary: 'failed',
        failure: { code: 'RETRIEVAL_FAILED', message: 'The source returned HTTP 404.', retryable: false },
      }).success,
    ).toBe(true);
  });

  it('rejects a pending envelope that carries completedAt or a failure', () => {
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'pending',
        summary: 'pending',
        completedAt: '2026-09-03T11:00:05.000Z',
      }).success,
    ).toBe(false);
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'pending',
        summary: 'pending',
        failure: { code: 'RETRIEVAL_FAILED', message: 'x', retryable: true },
      }).success,
    ).toBe(false);
  });

  it('rejects a complete envelope whose summary contradicts its checks', () => {
    const result = verificationEnvelopeSchema.safeParse({
      ...base,
      checks: checks({ proof: 'fail' }),
      state: 'complete',
      completedAt: '2026-09-03T11:00:05.000Z',
      summary: 'verified',
    });
    expect(result.success).toBe(false);
    expect(result.success ? [] : result.error.issues.map((issue) => issue.path)).toEqual([['summary']]);
  });

  it('rejects a complete envelope with a failure and a failed one without', () => {
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'complete',
        completedAt: '2026-09-03T11:00:05.000Z',
        summary: 'verified',
        failure: { code: 'RETRIEVAL_FAILED', message: 'x', retryable: true },
      }).success,
    ).toBe(false);
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'failed',
        completedAt: '2026-09-03T11:00:05.000Z',
        summary: 'failed',
      }).success,
    ).toBe(false);
  });

  it('rejects a partial checks object and an unknown failure code', () => {
    const partial: Partial<VerificationChecks> = { ...checks() };
    delete partial.schemaConformance;
    expect(
      verificationEnvelopeSchema.safeParse({ ...base, checks: partial, state: 'pending', summary: 'pending' }).success,
    ).toBe(false);
    expect(
      verificationEnvelopeSchema.safeParse({
        ...base,
        state: 'failed',
        completedAt: '2026-09-03T11:00:05.000Z',
        summary: 'failed',
        failure: { code: 'SOMETHING_ELSE', message: 'x', retryable: true },
      }).success,
    ).toBe(false);
  });
});

describe('deriveCurrencyStatus', () => {
  it('is unknown until at least one bound has been extracted', () => {
    expect(deriveCurrencyStatus(null, null, NOW)).toBe('unknown');
  });

  it('reports the bound now falls outside, and current inside or with an open bound', () => {
    const before = new Date('2026-09-04T00:00:00.000Z');
    const after = new Date('2026-09-01T00:00:00.000Z');
    expect(deriveCurrencyStatus(before, null, NOW)).toBe('not_yet_valid');
    expect(deriveCurrencyStatus(null, after, NOW)).toBe('expired');
    expect(deriveCurrencyStatus(after, before, NOW)).toBe('current');
    expect(deriveCurrencyStatus(after, null, NOW)).toBe('current');
    expect(deriveCurrencyStatus(null, before, NOW)).toBe('current');
  });
});

describe('toCredentialRecord', () => {
  it('projects a pending registration with every contract field set and no repository column leaked', () => {
    const projected = toCredentialRecord(
      record({
        external: {
          sourceDigest: 'zQmDigest',
          encrypted: false,
          contentKind: ExternalContentKind.CREDENTIAL,
          storageUri: 'https://storage.example/private/abc',
          decryptionKey: '{"protected":"envelope"}',
          dateReceived: new Date('2026-08-30T00:00:00.000Z'),
          notes: 'Received by email',
        },
        parent: {
          name: 'Cobalt Shipment DFR #91',
          issuerName: 'Cobalt Traders Ltd',
          issuerDid: 'did:web:cobalt-traders.example',
          subjectName: 'Cobalt shipment CB-2204',
          subjectId: 'https://cobalt-traders.example/shipments/CB-2204',
          validFrom: new Date('2026-07-22T10:00:00.000Z'),
          coreCredentialType: CoreCredentialType.DCC,
          credentialType: 'DigitalConformityCredential',
          coreDataModelVersion: '0.6.0',
          detailsStatus: CredentialDetailsStatus.EXTRACTED,
        },
      }),
      { now: NOW },
    );

    expect(projected).toEqual({
      id: 'crec0000000000000000000001',
      origin: 'external',
      credential: {
        name: 'Cobalt Shipment DFR #91',
        credentialType: 'DCC',
        issuerName: 'Cobalt Traders Ltd',
        issuerDid: 'did:web:cobalt-traders.example',
        subjectName: 'Cobalt shipment CB-2204',
        subjectId: 'https://cobalt-traders.example/shipments/CB-2204',
        validFrom: '2026-07-22T10:00:00.000Z',
        validUntil: null,
      },
      annotations: {
        annotationVersion: 1,
        displayName: 'Supplier DCC',
        declaredCredentialType: 'DCC',
        dateReceived: '2026-08-30',
        notes: 'Received by email',
      },
      organisationId: null,
      facilityId: null,
      productId: null,
      sourceUrl: 'https://supplier.example/credential-a',
      sourceDigest: 'zQmDigest',
      resolverUri: null,
      issuedAt: '2026-07-22T10:00:00.000Z',
      encrypted: false,
      hasKey: true,
      verification: {
        generation: 1,
        requestedAt: '2026-09-03T11:00:00.000Z',
        checks: checks({ retrieval: 'pass', digest: 'pass' }),
        state: 'pending',
        summary: 'pending',
      },
      currencyStatus: 'current',
      detailsStatus: 'EXTRACTED',
      detailsError: null,
      capabilities: { deletable: true, annotatable: true, verifiable: true },
      warnings: [],
      createdAt: '2026-09-03T11:00:00.000Z',
      updatedAt: '2026-09-03T11:00:05.000Z',
    });
    expect(JSON.stringify(projected)).not.toContain('envelope');
    expect(JSON.stringify(projected)).not.toContain('storage.example');
  });

  it('projects a failed generation with its failure and no key', () => {
    const projected = toCredentialRecord(
      record({
        run: {
          state: CheckRunState.FAILED,
          retrieval: CheckResult.FAIL,
          digest: CheckResult.NOT_RUN,
          failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
          failureMessage: 'The source returned HTTP 404. The same request will not succeed unless the source changes.',
          failureRetryable: false,
          completedAt: new Date('2026-09-03T11:00:05.000Z'),
        },
      }),
      { now: NOW },
    );
    expect(projected.verification).toEqual({
      generation: 1,
      requestedAt: '2026-09-03T11:00:00.000Z',
      completedAt: '2026-09-03T11:00:05.000Z',
      checks: checks({ retrieval: 'fail' }),
      state: 'failed',
      summary: 'failed',
      failure: {
        code: 'RETRIEVAL_FAILED',
        message: 'The source returned HTTP 404. The same request will not succeed unless the source changes.',
        retryable: false,
      },
    });
    expect(projected.hasKey).toBe(false);
    expect(projected.encrypted).toBeNull();
    expect(projected.detailsStatus).toBe('EXTRACTION_PENDING');
    expect(projected.currencyStatus).toBe('unknown');
  });

  it('derives a complete generation summary from the stored checks', () => {
    const settled = {
      state: CheckRunState.COMPLETE,
      proof: CheckResult.PASS,
      status: CheckResult.PASS,
      temporal: CheckResult.FAIL,
      completedAt: new Date('2026-09-03T11:00:05.000Z'),
    };
    expect(toCredentialRecord(record({ run: settled }), { now: NOW }).verification.summary).toBe('verified');
    expect(
      toCredentialRecord(record({ run: { ...settled, status: CheckResult.FAIL } }), { now: NOW }).verification.summary,
    ).toBe('not_conformant');
  });

  it('warns when a key went unused and when the declared type disagrees with the extracted one', () => {
    const projected = toCredentialRecord(
      record({
        external: { decryptionKeyUnused: true, declaredCredentialType: CoreCredentialType.DPP },
        parent: { coreCredentialType: CoreCredentialType.DCC, detailsStatus: CredentialDetailsStatus.EXTRACTED },
      }),
      { now: NOW },
    );
    expect(projected.warnings.map((warning) => warning.code)).toEqual([
      'DECRYPTION_KEY_UNUSED',
      'DECLARED_TYPE_MISMATCH',
    ]);
    expect(projected.warnings[1].message).toContain('declared as DPP');
  });

  it('projects an extraction failure with its error class', () => {
    const projected = toCredentialRecord(
      record({
        parent: {
          detailsStatus: CredentialDetailsStatus.EXTRACTION_FAILED,
          detailsError: CredentialDetailsError.UNREADABLE_ENVELOPE,
        },
      }),
      { now: NOW },
    );
    expect(projected.detailsStatus).toBe('EXTRACTION_FAILED');
    expect(projected.detailsError).toBe('UNREADABLE_ENVELOPE');
  });

  it('fails loudly on a settled run with no completedAt or a failed run with no failure', () => {
    expect(() => toCredentialRecord(record({ run: { state: CheckRunState.COMPLETE } }), { now: NOW })).toThrow(
      CredentialRecordProjectionError,
    );
    expect(() =>
      toCredentialRecord(
        record({ run: { state: CheckRunState.FAILED, completedAt: new Date('2026-09-03T11:00:05.000Z') } }),
        { now: NOW },
      ),
    ).toThrow(/no failure recorded/);
  });

  it('fails loudly on a row the envelope accepts but the contract schema rejects', () => {
    // The safety net at the end of the projection, distinct from the envelope's
    // own guards: this run is a perfectly valid pending one, and it is the
    // record's own field that the contract forbids. Fails if the safety net's
    // safeParse is dropped for a plain return of the projected object.
    const broken = record({
      external: { declaredCredentialType: 'NOT_A_CORE_TYPE' as CoreCredentialType },
    });
    expect(() => toCredentialRecord(broken, { now: NOW })).toThrow(CredentialRecordProjectionError);
    expect(() => toCredentialRecord(broken, { now: NOW })).toThrow(/crec0000000000000000000001/);
  });

  it('is checked by the same schema that publishes the component', () => {
    const projected = toCredentialRecord(record(), { now: NOW });
    expect(credentialRecordSchema.safeParse(projected).success).toBe(true);
    expect(credentialRecordSchema.safeParse({ ...projected, decryptionKey: 'x' }).success).toBe(false);
  });
});
