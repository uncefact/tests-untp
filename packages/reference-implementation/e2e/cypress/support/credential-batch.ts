import { decodeStoredCredential, decryptStoredCopy, expectStatusListIndex } from './stored-credential';
import { runnerReachableUri } from './config';

export type CredentialRequest = {
  credentialPayload: Record<string, any>;
  credentialType: string;
  version: string;
  statusPurposes: string[];
};

export type BatchItem = {
  index: number;
  state: string;
  credentialId?: string;
  warning?: unknown;
  error?: { code?: string; message?: string };
};

export function assertIssuedCredential(
  batchItem: BatchItem,
  requestItem: CredentialRequest,
  options: { label: string; expectedIssuer: string; statusPurposes: string[] },
): Cypress.Chainable<void> {
  const { label, expectedIssuer, statusPurposes } = options;
  expect(batchItem.credentialId, `${label} batch credentialId`).to.be.a('string').and.not.empty;
  const credentialId = batchItem.credentialId as string;

  return cy
    .request(`/api/v1/library/${credentialId}`)
    .then((libraryResponse) => {
      expect(libraryResponse.status, `${label} library status`).to.eq(200);
      expect(libraryResponse.body.id, `${label} library id`).to.eq(credentialId);
      expect(libraryResponse.body.origin, `${label} library origin`).to.eq('native');
      expect(libraryResponse.body.storageUri, `${label} storage URI`).to.be.a('string').and.not.empty;
      expect(libraryResponse.body.decryptionKey, `${label} library decryption key`).to.be.a('string').and.not.empty;
      expect(libraryResponse.body.warnings, `${label} library warnings`).to.be.an('array');

      const status = libraryResponse.body.status;
      expect(status, `${label} library status projection`).to.be.an('object');
      expect(status.capture, `${label} status capture`).to.eq('CAPTURED');
      expect(status.statusCaptureError, `${label} status capture error`).to.be.null;
      expect(status.entries, `${label} status entries`).to.be.an('array').and.have.length(statusPurposes.length);
      expect(
        status.entries.map((entry: Record<string, any>) => entry.statusPurpose),
        `${label} status purposes`,
      ).to.deep.eq(statusPurposes);

      status.entries.forEach((entry: Record<string, any>) => {
        expect(entry.entryId, `${label} status entry id`).to.be.a('string').and.not.empty;
        expect(entry.value, `${label} status value`).to.be.null;
        expect(entry.observedAt, `${label} status observedAt`).to.be.null;
        expect(entry.valueChangedAt, `${label} status valueChangedAt`).to.be.null;
        expect(entry.version, `${label} status version`).to.be.a('number').and.greaterThan(0);
        expectStatusListIndex(entry.statusListIndex, `${label} status-list index`, 'stored');
        expect(entry.statusListCredential, `${label} status-list credential`).to.be.a('string').and.not.empty;
        expect(entry.pending, `${label} pending status`).to.be.null;
      });

      expect(batchItem.warning ?? [], `${label} batch warnings`).to.deep.eq(libraryResponse.body.warnings);

      return cy
        .request({ method: 'GET', url: runnerReachableUri(libraryResponse.body.storageUri) })
        .then((storedResponse) => {
          expect(storedResponse.status, `${label} stored copy status`).to.eq(200);
          expect(storedResponse.body.type, `${label} stored envelope type`).to.eq('aes-256-gcm');
          expect(storedResponse.body.cipherText, `${label} stored envelope cipherText`).to.be.a('string').and.not.empty;
          expect(storedResponse.body.iv, `${label} stored envelope iv`).to.be.a('string').and.not.empty;
          expect(storedResponse.body.tag, `${label} stored envelope tag`).to.be.a('string').and.not.empty;

          return decryptStoredCopy(storedResponse.body, libraryResponse.body.decryptionKey).then((decryptedCopy) => {
            const storedCredential = decodeStoredCredential(decryptedCopy);
            expect(storedCredential.credentialSubject.id, `${label} stored credential subject id`).to.eq(
              requestItem.credentialPayload.credentialSubject.id,
            );

            const storedIssuer =
              typeof storedCredential.issuer === 'string' ? storedCredential.issuer : storedCredential.issuer?.id;
            expect(storedIssuer, `${label} stored credential issuer`).to.eq(expectedIssuer);
          });
        });
    })
    .then(() => undefined);
}
