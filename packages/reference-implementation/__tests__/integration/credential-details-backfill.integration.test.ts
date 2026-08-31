// Jest cannot load jose's ESM build in this suite. decodeJwt here only
// splits a compact JWT; production decodeCredential uses the real library.
jest.mock('jose', () => ({
  decodeJwt: (jwt: string) => {
    const { 1: payload, length } = jwt.split('.');
    if (length !== 3 || !payload) {
      throw new Error('Invalid JWT');
    }
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  },
}));

import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';
import { CredentialDetailsStatus } from '../../src/lib/prisma/generated/index.js';

/**
 * Integration coverage for the credential-details backfill (#953), against
 * real Postgres through the rig.
 *
 * The unit suite runs the backfill against a hand-written client whose
 * `findMany` reimplements the production query. This suite is the layer
 * that can fail if the PENDING filter, the version column, or the
 * idempotent second run do not hold against a real table.
 */

const client = createRigClient();

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
});

afterAll(async () => {
  await client.$disconnect();
});

function compactJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function envelopedCredential() {
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
    name: 'Wool Passport',
    issuer: { id: 'did:web:issuer.example', name: 'Example Issuer' },
    credentialSubject: {
      product: { id: 'https://example.com/product/1', name: 'Merino batch' },
    },
    validFrom: '2024-01-15T00:00:00.000Z',
    validUntil: '2025-01-15T00:00:00.000Z',
  };
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    id: `data:application/vc+jwt,${compactJwt(payload)}`,
    type: 'EnvelopedVerifiableCredential',
  };
}

describe('credential-details backfill against Postgres', () => {
  it('fills a pre-capture row, then reports zero changes on a second run', async () => {
    await client.credential.create({
      data: {
        id: 'c-pending',
        tenantId: SYSTEM_TENANT_ID,
        storageUri: 'https://storage.test/c-pending',
        digestMultibase: 'zQmPending',
        credentialType: 'DigitalProductPassport',
      },
    });

    const { backfillCredentialDetails } = await import('../../src/lib/credentials/backfill-credential-details');
    const fetchArtifact = async () => JSON.stringify(envelopedCredential());

    const first = await backfillCredentialDetails(client, { fetchArtifact });
    expect(first.failures).toEqual([]);
    expect(first.scanned).toBe(1);
    expect(first.updated).toBe(1);
    expect(first.failed).toBe(0);

    const afterFirst = await client.credential.findUniqueOrThrow({ where: { id: 'c-pending' } });
    expect(afterFirst.detailsStatus).toBe(CredentialDetailsStatus.EXTRACTED);
    expect(afterFirst.coreDataModelVersion).toBe('0.6.1');
    expect(afterFirst.name).toBe('Wool Passport');
    expect(afterFirst.issuerName).toBe('Example Issuer');
    expect(afterFirst.issuerDid).toBe('did:web:issuer.example');
    expect(afterFirst.subjectName).toBe('Merino batch');
    expect(afterFirst.subjectId).toBe('https://example.com/product/1');
    expect(afterFirst.validFrom).toEqual(new Date('2024-01-15T00:00:00.000Z'));
    expect(afterFirst.validUntil).toEqual(new Date('2025-01-15T00:00:00.000Z'));
    expect(afterFirst.detailsError).toBeNull();

    const second = await backfillCredentialDetails(client, { fetchArtifact });
    expect(second.scanned).toBe(0);
    expect(second.updated).toBe(0);
    expect(second.failed).toBe(0);

    const afterSecond = await client.credential.findUniqueOrThrow({ where: { id: 'c-pending' } });
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
    expect(afterSecond.name).toBe(afterFirst.name);
    expect(afterSecond.coreDataModelVersion).toBe(afterFirst.coreDataModelVersion);
  });
});
