import { config, runTag } from '../../../support/config';
import { readV070CredentialPayload } from '../../../support/v0.7-credential-payload';
import { assertIssuedCredential, type CredentialRequest } from '../../../support/credential-batch';

/**
 * Batch rows are left by design. The run-tag cleanup deletes the native
 * credentials through the credentials route, while batch retention owns the
 * batch rows because this release exposes no batch delete route.
 * Requests intentionally use the ordinary encrypted-storage default; the
 * native library decryption key opens each returned storage envelope.
 */
describe('Credential batch API', { testIsolation: false }, () => {
  const RUN_ID = runTag();
  const CREDENTIAL_TYPE = 'DigitalProductPassport';
  const CREDENTIAL_VERSION = '0.7.0';
  const STATUS_PURPOSES = config.capabilities.statusDefaultPurposes;
  const VALID_FROM = new Date().toISOString();
  const VALID_UNTIL = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  let issuerDid: string;
  let foreignDid: string;

  type BatchRequest = {
    items: CredentialRequest[];
  };

  type BatchItem = {
    index: number;
    reference?: string;
    state: string;
    credentialId?: string;
    warning?: unknown;
    error?: { code?: string; message?: string };
  };
  type BatchStatus = {
    state: string;
    counts: {
      total: number;
      queued: number;
      processing: number;
      issued: number;
      failed: number;
      unknown: number;
      cancelled: number;
    };
    items: BatchItem[];
  };

  type CredentialRequestSpec = {
    issuer: string;
    label: string;
    reference?: string;
  };

  function buildCredentialRequest(issuer: string, label: string): Cypress.Chainable<CredentialRequest> {
    return readV070CredentialPayload({
      templateDir: 'digital_product_passport',
      credentialId: `urn:uuid:e2e-batch-${label}-${RUN_ID}`,
      issuerDid: issuer,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    }).then((credentialPayload) => ({
      credentialPayload,
      credentialType: CREDENTIAL_TYPE,
      version: CREDENTIAL_VERSION,
      statusPurposes: STATUS_PURPOSES,
    }));
  }

  function buildBatchRequest(specs: CredentialRequestSpec[]): Cypress.Chainable<BatchRequest> {
    return specs
      .reduce(
        (chain, spec) =>
          chain.then((items) =>
            buildCredentialRequest(spec.issuer, spec.label).then((item) => [
              ...items,
              spec.reference === undefined ? item : { ...item, reference: spec.reference },
            ]),
          ),
        cy.wrap([] as CredentialRequest[]),
      )
      .then((items) => ({ items }));
  }
  function waitForBatchCompletion(statusUrl: string, timeoutMs = 120_000): Cypress.Chainable<BatchStatus> {
    const startedAt = Date.now();

    const poll = (): Cypress.Chainable<BatchStatus> => {
      const request = cy.request({ method: 'GET', url: statusUrl, failOnStatusCode: false }).then((response) => {
        const body = response.body as BatchStatus;
        expect(response.status, `GET ${statusUrl} status`).to.eq(200);

        if (body.state === 'COMPLETED') return body;
        if (body.state === 'NEEDS_ATTENTION') {
          throw new Error(`Credential batch settled as NEEDS_ATTENTION: ${JSON.stringify(body)}`);
        }
        if (body.state !== 'QUEUED' && body.state !== 'RUNNING') {
          throw new Error(`Credential batch entered unexpected state ${body.state}: ${JSON.stringify(body)}`);
        }
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(`Timed out waiting for credential batch completion; last response: ${JSON.stringify(body)}`);
        }

        return cy.wait(2_000).then(() => poll());
      });
      return request as unknown as Cypress.Chainable<BatchStatus>;
    };

    return poll();
  }

  before(() => {
    cy.task('getServiceAccountToken', config.serviceAccounts.sa2).then((result) => {
      const { accessToken } = result as { accessToken: string };
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: `e2e-batch-foreign-did-${RUN_ID}`,
          name: `E2E Batch foreign tenant DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        foreignDid = response.body.did;
      });
    });

    cy.apiLogin();

    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: `E2E Batch VCKit VC ${RUN_ID}`,
        config: {
          baseUrl: config.services.vckit.baseUrl,
          apiKey: config.services.vckit.apiKey,
        },
        apiVersion: '1.0.0',
        isPrimary: true,
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
    });

    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'STORAGE',
        adapterType: 'UNCEFACT_STORAGE',
        name: `E2E Batch Storage ${RUN_ID}`,
        config: {
          baseUrl: config.services.storage.baseUrl,
          apiKey: config.services.storage.apiKey,
          apiVersion: config.services.storage.apiVersion,
          publicBucket: config.services.storage.publicBucket,
          privateBucket: config.services.storage.privateBucket,
        },
        apiVersion: '3.1.0',
        isPrimary: true,
      },
    }).then((response) => {
      expect(response.status).to.eq(201);
    });

    cy.request('/api/v1/dids').then((response) => {
      expect(response.status).to.eq(200);
      const defaultDid = response.body.data.find((did: { did: string; isDefault?: boolean }) => did.isDefault === true);
      expect(defaultDid, 'A default DID must be configured for the batch issuer').to.exist;
      issuerDid = defaultDid.did;
    });
  });

  it('submits an ordered batch, waits for completion, and proves every item was issued', () => {
    const idempotencyKey = `e2e-batch-journey-${RUN_ID}`;
    const references = [`PO-${RUN_ID}-0`, `PO-${RUN_ID}-1`];
    buildBatchRequest([
      { issuer: issuerDid, label: 'valid-0', reference: references[0] },
      { issuer: issuerDid, label: 'valid-1', reference: references[1] },
      { issuer: issuerDid, label: 'valid-2' },
    ])
      .then((requestBody) =>
        cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: requestBody,
          })
          .then((response) => {
            expect(response.status).to.eq(202);
            expect(response.body.batchId).to.be.a('string').and.not.empty;
            expect(response.body.status).to.match(/^\/api\/v1\/credentials\/batches\/.+/);
            expect(response.headers.location).to.eq(response.body.status);

            return waitForBatchCompletion(response.body.status).then((status) => ({ status, requestBody }));
          }),
      )
      .then(({ status, requestBody: submitted }) => {
        expect(status.state).to.eq('COMPLETED');
        expect(status.counts).to.deep.eq({
          total: 3,
          queued: 0,
          processing: 0,
          issued: 3,
          failed: 0,
          unknown: 0,
          cancelled: 0,
        });
        expect(status.items).to.have.length(3);
        expect(status.items.map((item) => item.index)).to.deep.eq([0, 1, 2]);
        expect(status.items.map((item) => item.state)).to.deep.eq(['ISSUED', 'ISSUED', 'ISSUED']);
        expect(status.items[0].reference).to.eq(references[0]);
        expect(status.items[1].reference).to.eq(references[1]);
        expect(status.items[2]).not.to.have.property('reference');

        return assertIssuedCredential(status.items[0], submitted.items[0], {
          label: 'item 0',
          expectedIssuer: issuerDid,
          statusPurposes: STATUS_PURPOSES,
        })
          .then(() =>
            assertIssuedCredential(status.items[1], submitted.items[1], {
              label: 'item 1',
              expectedIssuer: issuerDid,
              statusPurposes: STATUS_PURPOSES,
            }),
          )
          .then(() =>
            assertIssuedCredential(status.items[2], submitted.items[2], {
              label: 'item 2',
              expectedIssuer: issuerDid,
              statusPurposes: STATUS_PURPOSES,
            }),
          );
      });
  });

  it('replays an identical batch and rejects a changed body for the same key', () => {
    const idempotencyKey = `e2e-batch-replay-${RUN_ID}`;
    buildBatchRequest([{ issuer: issuerDid, label: 'replay', reference: `PO-${RUN_ID}-replay-1` }])
      .then((requestBody) =>
        cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: requestBody,
          })
          .then((firstResponse) => {
            expect(firstResponse.status).to.eq(202);
            expect(firstResponse.body.batchId).to.be.a('string').and.not.empty;
            expect(firstResponse.headers.location).to.eq(firstResponse.body.status);

            return cy
              .request({
                method: 'POST',
                url: '/api/v1/credentials/batches',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: requestBody,
              })
              .then((replayResponse) => {
                expect(replayResponse.status).to.eq(202);
                expect(replayResponse.body.batchId).to.eq(firstResponse.body.batchId);
                expect(replayResponse.body.status).to.eq(firstResponse.body.status);
                expect(replayResponse.headers.location).to.eq(firstResponse.headers.location);
              })
              .then(() =>
                buildBatchRequest([{ issuer: issuerDid, label: 'replay', reference: `PO-${RUN_ID}-replay-2` }]).then(
                  (changedBody) =>
                    cy
                      .request({
                        method: 'POST',
                        url: '/api/v1/credentials/batches',
                        headers: { 'Idempotency-Key': idempotencyKey },
                        body: changedBody,
                        failOnStatusCode: false,
                      })
                      .then((changedResponse) => ({ changedResponse, statusUrl: firstResponse.body.status })),
                ),
              );
          }),
      )
      .then(({ changedResponse, statusUrl }) => {
        expect(changedResponse.status).to.eq(422);
        expect(changedResponse.body.code).to.eq('IDEMPOTENCY_KEY_MISMATCH');
        return waitForBatchCompletion(statusUrl);
      });
  });

  it('accepts distinct references and refuses a later duplicate reference', () => {
    buildBatchRequest([
      { issuer: issuerDid, label: 'reference-distinct-0', reference: `PO-${RUN_ID}-distinct-0` },
      { issuer: issuerDid, label: 'reference-distinct-1', reference: `PO-${RUN_ID}-distinct-1` },
    ])
      .then((distinctBody) =>
        cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': `e2e-batch-reference-distinct-${RUN_ID}` },
            body: distinctBody,
          })
          .then((acceptedResponse) => {
            expect(acceptedResponse.status).to.eq(202);
            return waitForBatchCompletion(acceptedResponse.body.status);
          }),
      )
      .then(() =>
        buildBatchRequest([
          { issuer: issuerDid, label: 'reference-duplicate-0', reference: `PO-${RUN_ID}-duplicate` },
          { issuer: issuerDid, label: 'reference-duplicate-1', reference: `PO-${RUN_ID}-other` },
          { issuer: issuerDid, label: 'reference-duplicate-2', reference: `PO-${RUN_ID}-duplicate` },
        ]).then((duplicateBody) =>
          cy.request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': `e2e-batch-reference-duplicate-${RUN_ID}` },
            body: duplicateBody,
            failOnStatusCode: false,
          }),
        ),
      )
      .then((duplicateResponse) => {
        expect(duplicateResponse.status).to.eq(400);
        expect(duplicateResponse.body).to.deep.eq({
          error: 'items[2].reference: must be unique within the batch; duplicates items[0].reference',
          code: 'VALIDATION_FAILED',
        });
      });
  });
  it('settles a mixed batch with one real issuance and one per-item refusal', () => {
    buildBatchRequest([
      { issuer: issuerDid, label: 'partial-issued' },
      { issuer: foreignDid, label: 'partial-failed' },
    ])
      .then((requestBody) =>
        cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': `e2e-batch-partial-${RUN_ID}` },
            body: requestBody,
          })
          .then((response) => {
            expect(response.status).to.eq(202);
            expect(response.body.batchId).to.be.a('string').and.not.empty;
            expect(response.headers.location).to.eq(response.body.status);
            return waitForBatchCompletion(response.body.status).then((status) => ({ status, requestBody }));
          }),
      )
      .then(({ status, requestBody }) => {
        expect(status.state).to.eq('COMPLETED');
        expect(status.counts).to.deep.eq({
          total: 2,
          queued: 0,
          processing: 0,
          issued: 1,
          failed: 1,
          unknown: 0,
          cancelled: 0,
        });
        expect(status.items).to.have.length(2);
        expect(status.items.map((item) => item.index)).to.deep.eq([0, 1]);
        expect(status.items[0].state).to.eq('ISSUED');
        expect(status.items[1].state).to.eq('FAILED');
        expect(status.items[1]).to.not.have.property('credentialId');
        expect(status.items[1].error?.code).to.eq('ISSUER_DID_NOT_REGISTERED');
        expect(status.items[1].error?.message).to.eq(
          `Issuer DID "${foreignDid}" is not registered to your tenant. You can only issue credentials with a DID that belongs to your tenant or the system default DID.`,
        );

        return assertIssuedCredential(status.items[0], requestBody.items[0], {
          label: 'partial issued item',
          expectedIssuer: issuerDid,
          statusPurposes: STATUS_PURPOSES,
        });
      });
  });
});
