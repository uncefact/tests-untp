jest.unmock('jose');

// The real lookup by default. One case answers with an organisation that no
// longer exists, which is how the entity-link retry is reached in production:
// the entity vanished between the lookup and the record write.
const mockResolvePrimaryEntity = jest.fn();
jest.mock('../../src/lib/entities/resolve-primary-entity', () => ({
  resolvePrimaryEntity: (...args: unknown[]) => mockResolvePrimaryEntity(...args),
}));

import type { IStorageService } from '@uncefact/untp-ri-services';
import { CheckRunFailureCode, CheckRunState, CoreCredentialType } from '../../src/lib/prisma/generated';
import { issueCredential } from '../../src/lib/credentials/issue-credential';
import { CredentialDocumentFetchError } from '../../src/lib/credentials/fetch-credential-document';
import {
  createExternalCredential,
  findExternalByContentDigest,
} from '../../src/lib/prisma/repositories/external-credential.repository';
import {
  registerExternalCredential,
  type RegisterExternalCredentialDependencies,
} from '../../src/lib/library/register-external-credential';
import { createVerifierDouble } from './helpers/verifiable-credential-service-double';
import { createRigClient, truncateApplicationTables } from './rig/db';
import { seedSystemTenant, SYSTEM_TENANT_ID } from './fixtures';

const client = createRigClient();

function envelopedCredential(): Record<string, unknown> {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential'],
    issuer: { id: 'did:web:issuer.example' },
    credentialSubject: { id: 'https://example.com/subject' },
  };
  return {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: `data:application/vc+jwt,${encode({ alg: 'ES256', typ: 'vc+jwt' })}.${encode(payload)}.sig`,
  };
}

async function issueThroughVerifier(tags: readonly string[]) {
  const verifier = createVerifierDouble();
  jest.spyOn(verifier, 'sign').mockResolvedValue(envelopedCredential() as never);
  return issueCredential({
    tenantId: SYSTEM_TENANT_ID,
    credentialPayload: { '@context': [], type: ['VerifiableCredential'], credentialSubject: {} } as never,
    credentialType: 'DigitalProductPassport',
    coreDataModelVersion: '0.7.0',
    refs: { organisations: [], facilities: [], products: [] },
    vcService: { service: verifier, instanceId: 'issuance-instance' },
    storageService: {
      service: {
        store: jest.fn().mockResolvedValue({
          uri: 'https://storage.test/issued-tagged-credential',
          digestMultibase: 'zissued-tagged-credential',
        }),
        storeBinary: jest.fn(),
        delete: jest.fn(),
      },
      instanceId: 'storage-instance',
    },
    storageOptions: { encrypt: false },
    bridge: { extractSubjectSummary: () => ({ id: undefined, name: undefined }) } as never,
    onDispatch: () => undefined,
    statusPurposes: [],
    tags,
  });
}

function notUsed(): never {
  throw new Error('not used in this test');
}

/** A registration whose source fetch fails, so no storage, encryption or queue is reached. */
const failingFetchDeps: RegisterExternalCredentialDependencies = {
  fetchDocument: async () => {
    throw new CredentialDocumentFetchError({
      kind: 'failed',
      reason: 'network',
      error: new Error('connection refused'),
    });
  },
  resolveStorage: async (): Promise<{ service: IStorageService; instanceId: string }> => notUsed(),
  assertEncryptionReady: notUsed,
  enqueueVerification: async () => notUsed(),
  persist: createExternalCredential,
  findExistingExternal: findExternalByContentDigest,
};

beforeAll(async () => {
  await client.$connect();
});

beforeEach(async () => {
  await truncateApplicationTables(client);
  await seedSystemTenant(client);
  const actual = jest.requireActual('../../src/lib/entities/resolve-primary-entity');
  mockResolvePrimaryEntity.mockReset();
  mockResolvePrimaryEntity.mockImplementation(actual.resolvePrimaryEntity);
});

afterAll(async () => {
  await client.$disconnect();
});

describe('tags given when a library record is created', () => {
  it('stores the tags on a natively issued record, in the order given', async () => {
    // Regression: tags threaded through issuance but not written by the
    // repository would leave the record untagged.
    const issued = await issueThroughVerifier(['zeta', 'audit-2026']);

    const record = await client.libraryRecord.findUniqueOrThrow({ where: { id: issued.credentialId } });
    expect(record.tags).toEqual(['zeta', 'audit-2026']);
    expect(record.tagVersion).toBe(1);
  });

  it('keeps the tags when the record is written again without its vanished entity link', async () => {
    // Regression: tags written on the first attempt only would be lost on
    // the retry that drops the entity columns.
    mockResolvePrimaryEntity.mockResolvedValue({ organisationId: 'organisation-that-does-not-exist' });

    const issued = await issueThroughVerifier(['cab-portal']);

    expect(issued.entityLinkFailed).toBe(true);
    const record = await client.libraryRecord.findUniqueOrThrow({ where: { id: issued.credentialId } });
    expect(record.tags).toEqual(['cab-portal']);
    const credential = await client.credential.findUniqueOrThrow({ where: { id: issued.credentialId } });
    expect(credential.organisationId).toBeNull();
  });

  it('stores the tags on an external record whose source could not be fetched', async () => {
    // Regression: a registration that settles as a retrieval failure still
    // creates a record in the library, and it must carry the tags it was given.
    const registered = await registerExternalCredential(
      {
        tenantId: SYSTEM_TENANT_ID,
        sourceUrl: 'https://supplier.example/credentials/1',
        annotations: { displayName: 'Supplier DPP', declaredCredentialType: CoreCredentialType.DPP },
        tags: ['supplier-a', 'q3'],
      },
      failingFetchDeps,
    );

    expect(registered.checkRun).toMatchObject({
      state: CheckRunState.FAILED,
      failureCode: CheckRunFailureCode.RETRIEVAL_FAILED,
    });
    const record = await client.libraryRecord.findUniqueOrThrow({ where: { id: registered.record.id } });
    expect(record.tags).toEqual(['supplier-a', 'q3']);
    expect(record.tagVersion).toBe(1);
  });
});
