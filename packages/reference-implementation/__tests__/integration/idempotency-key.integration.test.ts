import { IdempotencyOperation } from '../../src/lib/prisma/generated';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { insertNativeCredential, seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
} from '../../src/lib/prisma/repositories/idempotency-key.repository';
import { readStaleClaimMs } from '../../src/lib/config/idempotency-claim.config';
import { isEncryptedEnvelope } from '@uncefact/untp-ri-services/encryption';

process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

// The window an operator can widen; unset in tests, so this is the default.
const STALE_IN_FLIGHT_CLAIM_MS = readStaleClaimMs();
import { createCredential } from '../../src/lib/prisma/repositories/credential.repository';
import { IdempotencyClaimLostError } from '../../src/lib/prisma/repositories/idempotency-key.repository';

/**
 * Postgres round-trip for idempotency claims (#954).
 *
 * Unit tests cover classification of mocked Prisma outcomes. This suite is
 * the layer that can fail if the unique constraint does not serialise two
 * concurrent inserts, if a reclaimed original can still mutate the new
 * owner's row, or if a stale recorded result is produced again.
 */
describe('idempotency key', () => {
  const prisma = createRigClient();
  const KEY = 'concurrent-claim-key';
  const DIGEST = 'a'.repeat(64);
  const OTHER_OPERATION = IdempotencyOperation.LIBRARY_REGISTER;

  beforeEach(async () => {
    await truncateApplicationTables(prisma);
    await seedSystemTenant(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  function claimInput(overrides: { operation?: IdempotencyOperation; key?: string } = {}) {
    return {
      tenantId: SYSTEM_TENANT_ID,
      operation: overrides.operation ?? IdempotencyOperation.CREDENTIAL_ISSUE,
      key: overrides.key ?? KEY,
      bodyDigest: DIGEST,
    };
  }

  async function insertCredential() {
    return insertNativeCredential(prisma, {
      storageUri: 'https://storage.test/idempotent',
      digestMultibase: 'zIdempotent',
      coreDataModelVersion: '0.6.1',
    });
  }

  it('lets only one of two concurrent claims win, then replays after complete, then frees the key when the credential is deleted', async () => {
    const [first, second] = await Promise.all([claimIdempotencyKey(claimInput()), claimIdempotencyKey(claimInput())]);

    const outcomes = [first.outcome, second.outcome].sort();
    expect(outcomes).toEqual(['claimed', 'in-flight']);

    const claimed = first.outcome === 'claimed' ? first : second;
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    const credential = await insertCredential();
    await prisma.idempotencyKey.update({
      where: { id: claimed.claimId },
      data: { recordId: credential.id },
    });

    const completed = await completeIdempotencyKey({
      claimId: claimed.claimId,
      recordId: credential.id,
      responseBody: null,
    });
    expect(completed).toEqual({ applied: true });

    const replay = await claimIdempotencyKey(claimInput());
    expect(replay).toEqual({
      outcome: 'replay',
      recordId: credential.id,
      responseBody: null,
    });

    // The library record is the delete target (ADR-053 decision 1): removing
    // it cascades to the credential child and frees the claim.
    await prisma.libraryRecord.delete({ where: { id: credential.id } });

    const afterDelete = await claimIdempotencyKey(claimInput());
    expect(afterDelete).toEqual({ outcome: 'claimed', claimId: expect.any(String) });
  });

  it("does not let a reclaimed original complete the new owner's row", async () => {
    const original = await claimIdempotencyKey(claimInput());
    expect(original.outcome).toBe('claimed');
    if (original.outcome !== 'claimed') return;

    await prisma.idempotencyKey.update({
      where: { id: original.claimId },
      data: { createdAt: new Date(Date.now() - STALE_IN_FLIGHT_CLAIM_MS - 1) },
    });

    const reclaimed = await claimIdempotencyKey(claimInput());
    expect(reclaimed.outcome).toBe('claimed');
    if (reclaimed.outcome !== 'claimed') return;
    expect(reclaimed.claimId).not.toBe(original.claimId);

    const credential = await insertCredential();
    await prisma.idempotencyKey.update({
      where: { id: reclaimed.claimId },
      data: { recordId: credential.id },
    });

    const lateComplete = await completeIdempotencyKey({
      claimId: original.claimId,
      recordId: credential.id,
      responseBody: [{ code: 'SHOULD_NOT_LAND', message: 'late original' }],
    });
    expect(lateComplete).toEqual({ applied: false });

    const newRow = await prisma.idempotencyKey.findUnique({
      where: { id: reclaimed.claimId },
    });
    expect(newRow?.recordId).toBe(credential.id);
    expect(newRow?.responseBody).toBeNull();
    expect(newRow?.finalisedAt).toBeNull();
  });

  it('replays a stale row that already recorded a credential rather than issuing again', async () => {
    const credential = await insertCredential();
    const row = await prisma.idempotencyKey.create({
      data: {
        tenantId: SYSTEM_TENANT_ID,
        operation: IdempotencyOperation.CREDENTIAL_ISSUE,
        key: KEY,
        bodyDigest: DIGEST,
        recordId: credential.id,
        resultRecordedAt: new Date(Date.now() - STALE_IN_FLIGHT_CLAIM_MS - 1),
      },
    });

    const result = await claimIdempotencyKey(claimInput());
    expect(result).toEqual({
      outcome: 'replay',
      recordId: credential.id,
      responseBody: null,
    });

    const stored = await prisma.idempotencyKey.findUnique({ where: { id: row.id } });
    expect(stored?.finalisedAt).not.toBeNull();
    expect(
      await prisma.idempotencyKey.count({
        where: { tenantId: SYSTEM_TENANT_ID, operation: IdempotencyOperation.CREDENTIAL_ISSUE, key: KEY },
      }),
    ).toBe(1);
  });

  it('associates the claim on the entity-link retry, and still fences a lost claim on that path', async () => {
    // The retry runs its own transaction after a foreign-key violation, so it
    // has to carry both guarantees the first attempt did: the association is
    // written with the credential, and a claim taken by someone else aborts it.
    const kept = await claimIdempotencyKey(claimInput());
    expect(kept.outcome).toBe('claimed');
    if (kept.outcome !== 'claimed') return;

    const { credential, entityLinkFailed } = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/retry',
      digestMultibase: 'zRetry',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
      // No such organisation, so the first create violates the foreign key and
      // the retry runs without the entity columns.
      organisationId: 'organisation-that-does-not-exist',
      idempotencyClaimId: kept.claimId,
    });

    expect(entityLinkFailed).toBe(true);
    const claimAfterRetry = await prisma.idempotencyKey.findUnique({ where: { id: kept.claimId } });
    expect(claimAfterRetry?.recordId).toBe(credential.id);
    expect(claimAfterRetry?.resultRecordedAt).not.toBeNull();

    // Same path, but the claim is gone by the time the retry associates.
    const doomed = await claimIdempotencyKey(claimInput({ key: `${KEY}-doomed` }));
    expect(doomed.outcome).toBe('claimed');
    if (doomed.outcome !== 'claimed') return;
    await prisma.idempotencyKey.delete({ where: { id: doomed.claimId } });

    const before = await prisma.credential.count();
    await expect(
      createCredential({
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'https://storage.test/doomed',
        digestMultibase: 'zDoomed',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        organisationId: 'organisation-that-does-not-exist',
        idempotencyClaimId: doomed.claimId,
      }),
    ).rejects.toThrow(IdempotencyClaimLostError);
    expect(await prisma.credential.count()).toBe(before);
  });

  it("rolls back a reclaimed original's association so only one credential remains for the key", async () => {
    const original = await claimIdempotencyKey(claimInput());
    expect(original.outcome).toBe('claimed');
    if (original.outcome !== 'claimed') return;

    await prisma.idempotencyKey.update({
      where: { id: original.claimId },
      data: { createdAt: new Date(Date.now() - STALE_IN_FLIGHT_CLAIM_MS - 1) },
    });

    const reclaimed = await claimIdempotencyKey(claimInput());
    expect(reclaimed.outcome).toBe('claimed');
    if (reclaimed.outcome !== 'claimed') return;
    expect(reclaimed.claimId).not.toBe(original.claimId);

    const winner = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/winner',
      digestMultibase: 'zWinner',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
      idempotencyClaimId: reclaimed.claimId,
    });

    await expect(
      createCredential({
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'https://storage.test/loser',
        digestMultibase: 'zLoser',
        credentialType: 'DigitalProductPassport',
        coreDataModelVersion: '0.6.1',
        idempotencyClaimId: original.claimId,
      }),
    ).rejects.toBeInstanceOf(IdempotencyClaimLostError);

    expect(await prisma.credential.count()).toBe(1);
    const remaining = await prisma.credential.findMany();
    expect(remaining[0].id).toBe(winner.credential.id);

    const keyRow = await prisma.idempotencyKey.findUnique({
      where: {
        tenantId_operation_key: {
          tenantId: SYSTEM_TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: KEY,
        },
      },
    });
    expect(keyRow?.id).toBe(reclaimed.claimId);
    expect(keyRow?.recordId).toBe(winner.credential.id);
    expect(keyRow?.resultRecordedAt).not.toBeNull();
  });

  it('lets the first finalisation win and leaves a second complete as a no-op', async () => {
    const claimed = await claimIdempotencyKey(claimInput());
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    const { credential } = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/cas',
      digestMultibase: 'zCas',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
      idempotencyClaimId: claimed.claimId,
    });

    const first = await completeIdempotencyKey({
      claimId: claimed.claimId,
      recordId: credential.id,
      responseBody: [{ code: 'ENTITY_LINK_FAILED', message: 'from original' }],
    });
    expect(first).toEqual({ applied: true });

    const second = await completeIdempotencyKey({
      claimId: claimed.claimId,
      recordId: credential.id,
      responseBody: [{ code: 'SHOULD_NOT_LAND', message: 'from stale replayer' }],
    });
    expect(second).toEqual({ applied: false });

    const stored = await prisma.idempotencyKey.findUnique({
      where: { id: claimed.claimId },
    });
    expect(typeof stored?.responseBody).toBe('string');
    expect(stored?.responseBody).not.toContain('ENTITY_LINK_FAILED');
    expect(isEncryptedEnvelope(JSON.parse(stored!.responseBody as string))).toBe(true);
  });

  it('stores an encrypted envelope and replays the original body unchanged', async () => {
    const claimed = await claimIdempotencyKey(claimInput());
    expect(claimed.outcome).toBe('claimed');
    if (claimed.outcome !== 'claimed') return;

    const { credential } = await createCredential({
      tenantId: SYSTEM_TENANT_ID,
      storageUri: 'https://storage.test/envelope',
      digestMultibase: 'zEnvelope',
      credentialType: 'DigitalProductPassport',
      coreDataModelVersion: '0.6.1',
      idempotencyClaimId: claimed.claimId,
    });

    const body = [{ code: 'ENTITY_LINK_FAILED', message: 'gone-from-the-clear-column' }];
    const completed = await completeIdempotencyKey({
      claimId: claimed.claimId,
      recordId: credential.id,
      responseBody: body,
    });
    expect(completed).toEqual({ applied: true });

    const stored = await prisma.idempotencyKey.findUnique({
      where: { id: claimed.claimId },
    });
    expect(typeof stored?.responseBody).toBe('string');
    expect(stored?.responseBody).not.toContain('gone-from-the-clear-column');
    expect(stored?.responseBody).not.toContain('ENTITY_LINK_FAILED');
    expect(isEncryptedEnvelope(JSON.parse(stored!.responseBody as string))).toBe(true);

    const replay = await claimIdempotencyKey(claimInput());
    expect(replay).toEqual({
      outcome: 'replay',
      recordId: credential.id,
      responseBody: body,
    });
  });

  it('lets the same tenant and key claim two different operations independently', async () => {
    // Unique on (tenantId, key) alone would make one of these in-flight.
    const [issue, other] = await Promise.all([
      claimIdempotencyKey(claimInput()),
      claimIdempotencyKey(claimInput({ operation: OTHER_OPERATION })),
    ]);

    expect(issue.outcome).toBe('claimed');
    expect(other.outcome).toBe('claimed');
    if (issue.outcome !== 'claimed' || other.outcome !== 'claimed') return;
    expect(issue.claimId).not.toBe(other.claimId);
    expect(await prisma.idempotencyKey.count({ where: { tenantId: SYSTEM_TENANT_ID, key: KEY } })).toBe(2);
  });

  it('does not replay a completed claim when the same key is used for a different operation', async () => {
    const issue = await claimIdempotencyKey(claimInput());
    expect(issue.outcome).toBe('claimed');
    if (issue.outcome !== 'claimed') return;

    const credential = await insertCredential();
    await prisma.idempotencyKey.update({
      where: { id: issue.claimId },
      data: { recordId: credential.id },
    });
    await completeIdempotencyKey({
      claimId: issue.claimId,
      recordId: credential.id,
      responseBody: [{ code: 'ENTITY_LINK_FAILED', message: 'from issue' }],
    });

    const other = await claimIdempotencyKey(claimInput({ operation: OTHER_OPERATION }));
    expect(other).toEqual({ outcome: 'claimed', claimId: expect.any(String) });
    if (other.outcome !== 'claimed') return;
    expect(other.claimId).not.toBe(issue.claimId);

    const replayIssue = await claimIdempotencyKey(claimInput());
    expect(replayIssue).toEqual({
      outcome: 'replay',
      recordId: credential.id,
      responseBody: [{ code: 'ENTITY_LINK_FAILED', message: 'from issue' }],
    });
  });
});
