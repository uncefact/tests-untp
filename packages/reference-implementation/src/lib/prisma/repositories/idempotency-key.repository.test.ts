process.env.DATA_ENCRYPTION_KEY = 'a'.repeat(64);
delete process.env.SERVICE_ENCRYPTION_KEY;

const mockError = jest.fn();
jest.mock('@/lib/api/logger', () => ({
  apiLogger: { child: () => ({ info: jest.fn(), warn: jest.fn(), error: mockError }) },
}));

import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  findIdempotencyKey,
  releaseIdempotencyKey,
} from './idempotency-key.repository';
import { readStaleClaimMs } from '@/lib/config/idempotency-claim.config';
import { getEncryptionService } from '@/lib/encryption/encryption';
import {
  AesGcmEncryptionAdapter,
  EncryptionAlgorithm,
  isEncryptedEnvelope,
} from '@uncefact/untp-ri-services/encryption';
import { createLogger } from '@uncefact/untp-ri-services/logging';
import { IdempotencyOperation } from '../generated';
import { prismaError } from '../db-errors.fixtures';

// The window an operator can widen; unset in tests, so this is the default.
const STALE_IN_FLIGHT_CLAIM_MS = readStaleClaimMs();

jest.mock('../prisma', () => ({
  prisma: {
    idempotencyKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
  },
}));

import { prisma } from '../prisma';

const mockKey = prisma.idempotencyKey as unknown as {
  create: jest.Mock;
  findUnique: jest.Mock;
  deleteMany: jest.Mock;
  updateMany: jest.Mock;
};

describe('idempotency-key.repository', () => {
  const TENANT_ID = 'tenant-1';
  const KEY = 'pipeline-retry-1';
  const DIGEST = 'a'.repeat(64);
  const CLAIM_ID = 'claim-1';
  const OTHER_DIGEST = 'b'.repeat(64);
  const OTHER_OPERATION = IdempotencyOperation.LIBRARY_REGISTER;

  const NOW = new Date('2026-08-27T10:00:00.000Z').getTime();
  const STALE_CREATED_AT = new Date(NOW - STALE_IN_FLIGHT_CLAIM_MS - 1);
  const FRESH_CREATED_AT = new Date(NOW);
  const NINE_MINUTES_AGO = new Date(NOW - 9 * 60 * 1000);
  const ELEVEN_MINUTES_AGO = new Date(NOW - 11 * 60 * 1000);
  const EXACTLY_THE_WINDOW = new Date(NOW - STALE_IN_FLIGHT_CLAIM_MS);
  const DISTINCTIVE = 'gone-from-the-clear-column';
  const PLAIN_BODY = [{ code: 'ENTITY_LINK_FAILED', message: DISTINCTIVE }];
  const FOREIGN_KEY = 'f'.repeat(64);

  function protectBody(value: unknown): string {
    return JSON.stringify(getEncryptionService().encrypt(JSON.stringify(value), EncryptionAlgorithm.AES_256_GCM));
  }

  function envelopeUnder(key: string, value: unknown): string {
    const adapter = new AesGcmEncryptionAdapter(key, createLogger());
    return JSON.stringify(adapter.encrypt(JSON.stringify(value), EncryptionAlgorithm.AES_256_GCM));
  }

  function writtenResponseBody(): string {
    const written = mockKey.updateMany.mock.calls[0][0].data.responseBody as unknown;
    expect(typeof written).toBe('string');
    return written as string;
  }

  function expectEnvelope(stored: string, distinctive: string) {
    expect(stored).not.toContain(distinctive);
    expect(isEncryptedEnvelope(JSON.parse(stored))).toBe(true);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function storedRow(overrides: Record<string, unknown> = {}) {
    return {
      id: CLAIM_ID,
      tenantId: TENANT_ID,
      operation: IdempotencyOperation.CREDENTIAL_ISSUE,
      key: KEY,
      bodyDigest: DIGEST,
      credentialId: null,
      resultRecordedAt: null,
      responseBody: null,
      finalisedAt: null,
      createdAt: FRESH_CREATED_AT,
      ...overrides,
    };
  }

  function claimInput(overrides: Partial<{ operation: IdempotencyOperation; key: string; bodyDigest: string }> = {}) {
    return {
      tenantId: TENANT_ID,
      operation: IdempotencyOperation.CREDENTIAL_ISSUE,
      key: KEY,
      bodyDigest: DIGEST,
      ...overrides,
    };
  }

  /** The colliding row must be read back for the same tenant, operation and key that failed to insert. */
  function expectClaimLookup(operation: IdempotencyOperation = IdempotencyOperation.CREDENTIAL_ISSUE) {
    expect(mockKey.findUnique).toHaveBeenCalledWith({
      where: { tenantId_operation_key: { tenantId: TENANT_ID, operation, key: KEY } },
    });
  }

  describe('claimIdempotencyKey', () => {
    it('returns claimed with the inserted row id when the insert succeeds', async () => {
      mockKey.create.mockResolvedValue({ id: CLAIM_ID });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'claimed', claimId: CLAIM_ID });
      expect(mockKey.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: KEY,
          bodyDigest: DIGEST,
        },
      });
      expect(mockKey.findUnique).not.toHaveBeenCalled();
    });

    it('returns mismatch when the colliding row has a different body digest', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(storedRow({ bodyDigest: OTHER_DIGEST, credentialId: 'cred-1' }));

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'mismatch' });
      expectClaimLookup();
    });

    it('returns mismatch on a stale in-flight row with a different digest rather than reclaiming it', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({ bodyDigest: OTHER_DIGEST, createdAt: STALE_CREATED_AT, credentialId: 'cred-1' }),
      );

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'mismatch' });
      expect(mockKey.deleteMany).not.toHaveBeenCalled();
      expect(mockKey.updateMany).not.toHaveBeenCalled();
      expect(mockKey.create).toHaveBeenCalledTimes(1);
    });

    it('returns in-flight when the colliding row has the same digest and no credential', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(storedRow());

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expectClaimLookup();
      expect(mockKey.deleteMany).not.toHaveBeenCalled();
      expect(mockKey.create).toHaveBeenCalledTimes(1);
    });

    it('returns in-flight when the colliding row has a credential, no finalisedAt, and is still fresh', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(storedRow({ credentialId: 'cred-1' }));

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expect(mockKey.updateMany).not.toHaveBeenCalled();
      expect(mockKey.create).toHaveBeenCalledTimes(1);
    });

    it('returns replay when the colliding row is already finalised', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: protectBody(PLAIN_BODY),
          finalisedAt: new Date(NOW),
        }),
      );

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });
      expect(mockKey.updateMany).not.toHaveBeenCalled();
    });

    it('replays a stale unfinalised row that already recorded a credential, and marks it finalised', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: protectBody(PLAIN_BODY),
          resultRecordedAt: ELEVEN_MINUTES_AGO,
        }),
      );
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });
      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: { responseBody: expect.any(String), finalisedAt: new Date(NOW) },
      });
      expectEnvelope(writtenResponseBody(), DISTINCTIVE);
      expect(mockKey.deleteMany).not.toHaveBeenCalled();
    });

    it('re-reads the winner finalised body when a stale-recorded CAS loses', async () => {
      const winnerBody = [{ code: 'ENTITY_LINK_FAILED', message: 'from original' }];
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique
        .mockResolvedValueOnce(
          storedRow({ credentialId: 'cred-1', resultRecordedAt: ELEVEN_MINUTES_AGO, responseBody: null }),
        )
        .mockResolvedValueOnce(
          storedRow({
            credentialId: 'cred-1',
            resultRecordedAt: ELEVEN_MINUTES_AGO,
            responseBody: protectBody(winnerBody),
            finalisedAt: new Date(NOW),
          }),
        );
      mockKey.updateMany.mockResolvedValue({ count: 0 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: winnerBody,
      });
      expect(mockKey.findUnique).toHaveBeenNthCalledWith(2, { where: { id: CLAIM_ID } });
    });

    it('treats a claim recorded 9 minutes ago as in-flight even when createdAt is older', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          createdAt: ELEVEN_MINUTES_AGO,
          resultRecordedAt: NINE_MINUTES_AGO,
        }),
      );

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expect(mockKey.updateMany).not.toHaveBeenCalled();
    });

    it('treats a claim recorded 11 minutes ago as a stale-recorded replay even when createdAt is fresh', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          createdAt: FRESH_CREATED_AT,
          resultRecordedAt: ELEVEN_MINUTES_AGO,
        }),
      );
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: null,
      });
    });

    it('ages a claim with no credential from createdAt', async () => {
      mockKey.create.mockRejectedValueOnce(prismaError('P2002')).mockResolvedValueOnce({ id: 'row-2' });
      mockKey.findUnique.mockResolvedValue(storedRow({ createdAt: ELEVEN_MINUTES_AGO }));
      mockKey.deleteMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'claimed', claimId: 'row-2' });
      expect(mockKey.deleteMany).toHaveBeenCalledTimes(1);
    });

    it('returns a non-array stored responseBody as stored on replay', async () => {
      const responseBody = { code: 'not-a-list' };
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: protectBody(responseBody),
          finalisedAt: new Date(NOW),
        }),
      );

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody,
      });
    });

    it('deletes a stale empty row and re-claims it', async () => {
      mockKey.create.mockRejectedValueOnce(prismaError('P2002')).mockResolvedValueOnce({ id: 'row-2' });
      mockKey.findUnique.mockResolvedValue(storedRow({ createdAt: STALE_CREATED_AT }));
      mockKey.deleteMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'claimed', claimId: 'row-2' });
      expectClaimLookup();
      expect(mockKey.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: KEY,
          credentialId: null,
          createdAt: { lte: new Date(NOW - STALE_IN_FLIGHT_CLAIM_MS) },
        },
      });
      expect(mockKey.create).toHaveBeenCalledTimes(2);
    });

    it('does not delete a fresh in-flight row', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(storedRow({ createdAt: new Date(NOW - STALE_IN_FLIGHT_CLAIM_MS + 60_000) }));

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expectClaimLookup();
      expect(mockKey.deleteMany).not.toHaveBeenCalled();
    });

    it('treats a claim aged exactly the window as stale in both the in-memory check and the delete predicate', async () => {
      mockKey.create.mockRejectedValueOnce(prismaError('P2002')).mockResolvedValueOnce({ id: 'row-2' });
      mockKey.findUnique.mockResolvedValue(storedRow({ createdAt: EXACTLY_THE_WINDOW }));
      mockKey.deleteMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'claimed', claimId: 'row-2' });
      expect(mockKey.deleteMany).toHaveBeenCalledWith({
        where: {
          tenantId: TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: KEY,
          credentialId: null,
          createdAt: { lte: EXACTLY_THE_WINDOW },
        },
      });
    });

    it('returns in-flight when a unique collision is followed by a vanished row', async () => {
      mockKey.create.mockRejectedValueOnce(prismaError('P2002')).mockRejectedValueOnce(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(null);

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expect(mockKey.findUnique).toHaveBeenCalledTimes(2);
    });

    it('classifies the winning row when a stale delete then re-insert loses the race', async () => {
      mockKey.create.mockRejectedValueOnce(prismaError('P2002')).mockRejectedValueOnce(prismaError('P2002'));
      mockKey.findUnique
        .mockResolvedValueOnce(storedRow({ createdAt: STALE_CREATED_AT }))
        .mockResolvedValueOnce(storedRow({ id: 'winner-claim', createdAt: FRESH_CREATED_AT }));
      mockKey.deleteMany.mockResolvedValue({ count: 1 });

      const result = await claimIdempotencyKey(claimInput());

      expect(result).toEqual({ outcome: 'in-flight' });
      expect(mockKey.deleteMany).toHaveBeenCalledTimes(1);
      expect(mockKey.create).toHaveBeenCalledTimes(2);
    });

    it('lets the same tenant and key claim two different operations independently', async () => {
      // If insert omitted operation, the second create would collide on
      // (tenantId, key) and the second caller would see the first claim.
      mockKey.create.mockResolvedValueOnce({ id: 'claim-issue' }).mockResolvedValueOnce({ id: 'claim-other' });

      const issue = await claimIdempotencyKey(claimInput());
      const other = await claimIdempotencyKey(claimInput({ operation: OTHER_OPERATION }));

      expect(issue).toEqual({ outcome: 'claimed', claimId: 'claim-issue' });
      expect(other).toEqual({ outcome: 'claimed', claimId: 'claim-other' });
      expect(mockKey.create).toHaveBeenNthCalledWith(1, {
        data: {
          tenantId: TENANT_ID,
          operation: IdempotencyOperation.CREDENTIAL_ISSUE,
          key: KEY,
          bodyDigest: DIGEST,
        },
      });
      expect(mockKey.create).toHaveBeenNthCalledWith(2, {
        data: {
          tenantId: TENANT_ID,
          operation: OTHER_OPERATION,
          key: KEY,
          bodyDigest: DIGEST,
        },
      });
      expect(mockKey.findUnique).not.toHaveBeenCalled();
    });

    it('does not replay a completed claim for a different operation', async () => {
      // Insert for the other operation must not look up the completed issuance
      // row. If the unique omitted operation, create would collide and replay.
      mockKey.create.mockResolvedValue({ id: 'claim-other' });

      const result = await claimIdempotencyKey(claimInput({ operation: OTHER_OPERATION }));

      expect(result).toEqual({ outcome: 'claimed', claimId: 'claim-other' });
      expect(mockKey.findUnique).not.toHaveBeenCalled();
      expect(mockKey.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          operation: OTHER_OPERATION,
          key: KEY,
          bodyDigest: DIGEST,
        },
      });
    });
  });

  describe('findIdempotencyKey', () => {
    it('returns absent when no row exists', async () => {
      mockKey.findUnique.mockResolvedValue(null);

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({ outcome: 'absent' });
      expect(mockKey.create).not.toHaveBeenCalled();
    });

    it('returns absent for a stale empty row so the caller can validate and reclaim', async () => {
      mockKey.findUnique.mockResolvedValue(storedRow({ createdAt: STALE_CREATED_AT }));

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({ outcome: 'absent' });
      expect(mockKey.deleteMany).not.toHaveBeenCalled();
      expect(mockKey.create).not.toHaveBeenCalled();
    });

    it('returns in-flight for a fresh empty row', async () => {
      mockKey.findUnique.mockResolvedValue(storedRow());

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({ outcome: 'in-flight' });
    });

    it('returns in-flight for a fresh unfinalised row that already recorded a credential', async () => {
      mockKey.findUnique.mockResolvedValue(storedRow({ credentialId: 'cred-1' }));

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({ outcome: 'in-flight' });
      expect(mockKey.updateMany).not.toHaveBeenCalled();
    });

    it('returns mismatch when the stored digest differs', async () => {
      mockKey.findUnique.mockResolvedValue(storedRow({ bodyDigest: OTHER_DIGEST, credentialId: 'cred-1' }));

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({ outcome: 'mismatch' });
    });

    it('returns replay for a finalised row with the same digest', async () => {
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: protectBody(PLAIN_BODY),
          finalisedAt: new Date(NOW),
        }),
      );

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });
    });

    it('replays a stale unfinalised recorded row and marks it finalised', async () => {
      mockKey.findUnique.mockResolvedValue(storedRow({ credentialId: 'cred-1', resultRecordedAt: ELEVEN_MINUTES_AGO }));
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: null,
      });
      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: { responseBody: null, finalisedAt: new Date(NOW) },
      });
    });

    it('re-reads the winner finalised body when a stale-recorded CAS loses', async () => {
      const winnerBody = [{ code: 'IDR_PUBLISH_FAILED', message: 'from original' }];
      mockKey.findUnique
        .mockResolvedValueOnce(
          storedRow({ credentialId: 'cred-1', resultRecordedAt: ELEVEN_MINUTES_AGO, responseBody: null }),
        )
        .mockResolvedValueOnce(
          storedRow({
            credentialId: 'cred-1',
            resultRecordedAt: ELEVEN_MINUTES_AGO,
            responseBody: protectBody(winnerBody),
            finalisedAt: new Date(NOW),
          }),
        );
      mockKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(findIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: winnerBody,
      });
      expect(mockKey.findUnique).toHaveBeenNthCalledWith(2, { where: { id: CLAIM_ID } });
    });

    it('looks up by tenant, operation and key, so a completed claim for another operation is not returned', async () => {
      mockKey.findUnique.mockResolvedValue(null);

      await expect(findIdempotencyKey(claimInput({ operation: OTHER_OPERATION }))).resolves.toEqual({
        outcome: 'absent',
      });
      expectClaimLookup(OTHER_OPERATION);
    });
  });

  describe('completeIdempotencyKey', () => {
    it('writes the response body and finalisedAt only for this claim, credential, and unfinalised row', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        completeIdempotencyKey({ claimId: CLAIM_ID, credentialId: 'cred-1', responseBody: PLAIN_BODY }),
      ).resolves.toEqual({ applied: true });

      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: { responseBody: expect.any(String), finalisedAt: new Date(NOW) },
      });
      expectEnvelope(writtenResponseBody(), DISTINCTIVE);
    });

    it('writes SQL-null responseBody when the body is null', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      await completeIdempotencyKey({ claimId: CLAIM_ID, credentialId: 'cred-1', responseBody: null });

      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: { responseBody: null, finalisedAt: new Date(NOW) },
      });
    });

    it('is a no-op that cannot overwrite when the row is already finalised', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        completeIdempotencyKey({
          claimId: CLAIM_ID,
          credentialId: 'cred-1',
          responseBody: [{ code: 'SHOULD_NOT_LAND', message: 'late original' }],
        }),
      ).resolves.toEqual({
        applied: false,
      });
      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: {
          responseBody: expect.any(String),
          finalisedAt: new Date(NOW),
        },
      });
      expectEnvelope(writtenResponseBody(), 'SHOULD_NOT_LAND');
    });
  });

  describe('response body at rest', () => {
    it('writes an envelope, not the plaintext body', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 1 });

      await completeIdempotencyKey({
        claimId: CLAIM_ID,
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });

      const stored = writtenResponseBody();
      expectEnvelope(stored, DISTINCTIVE);
      expect(stored).not.toContain('ENTITY_LINK_FAILED');
    });

    it('replays the original value structurally unchanged after a complete', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 1 });
      await completeIdempotencyKey({
        claimId: CLAIM_ID,
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });
      const stored = writtenResponseBody();

      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: stored,
          finalisedAt: new Date(NOW),
        }),
      );

      await expect(claimIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: PLAIN_BODY,
      });
    });

    it('replays the credential id, logs at error, and does not throw when the stored body cannot be decrypted', async () => {
      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({
          credentialId: 'cred-1',
          responseBody: envelopeUnder(FOREIGN_KEY, PLAIN_BODY),
          finalisedAt: new Date(NOW),
        }),
      );

      await expect(claimIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: null,
        responseBodyUnreadable: true,
      });
      expect(mockError).toHaveBeenCalledWith(
        expect.objectContaining({ claimId: CLAIM_ID, stage: 'decrypt', tenantId: TENANT_ID, err: expect.anything() }),
        'Failed to read stored idempotency response body',
      );
    });

    it('stores SQL NULL for an absent body and replays it as null', async () => {
      mockKey.updateMany.mockResolvedValue({ count: 1 });
      await completeIdempotencyKey({ claimId: CLAIM_ID, credentialId: 'cred-1', responseBody: null });
      expect(mockKey.updateMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: 'cred-1', finalisedAt: null },
        data: { responseBody: null, finalisedAt: new Date(NOW) },
      });

      mockKey.create.mockRejectedValue(prismaError('P2002'));
      mockKey.findUnique.mockResolvedValue(
        storedRow({ credentialId: 'cred-1', responseBody: null, finalisedAt: new Date(NOW) }),
      );

      await expect(claimIdempotencyKey(claimInput())).resolves.toEqual({
        outcome: 'replay',
        credentialId: 'cred-1',
        responseBody: null,
      });
      expect(mockError).not.toHaveBeenCalled();
    });
  });

  describe('releaseIdempotencyKey', () => {
    it('deletes the claimed row while it has no credential', async () => {
      mockKey.deleteMany.mockResolvedValue({ count: 1 });

      await expect(releaseIdempotencyKey({ claimId: CLAIM_ID })).resolves.toEqual({ applied: true });

      expect(mockKey.deleteMany).toHaveBeenCalledWith({
        where: { id: CLAIM_ID, credentialId: null },
      });
    });

    it('is a no-op when the claim id no longer owns an unrecorded row', async () => {
      mockKey.deleteMany.mockResolvedValue({ count: 0 });

      await expect(releaseIdempotencyKey({ claimId: 'stale-claim' })).resolves.toEqual({
        applied: false,
      });
    });
  });
});
