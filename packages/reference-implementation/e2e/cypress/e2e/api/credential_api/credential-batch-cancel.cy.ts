import { config, runTag } from '../../../support/config';
import {
  assertIssuedCredential,
  buildCredentialRequest,
  type BatchItem,
  type CredentialRequest,
  type CredentialRequestFixture,
} from '../../../support/credential-batch';

/**
 * Batch rows are left by design. The existing run-tag cleanup removes the
 * issued native credentials through the credentials route, while batch
 * retention owns the batch rows because this release has no batch delete route.
 */
describe('Credential batch cancellation API', { testIsolation: false }, () => {
  const RUN_ID = runTag();
  const CREDENTIAL_TYPE = 'DigitalProductPassport';
  const CREDENTIAL_VERSION = '0.6.1';
  const STATUS_PURPOSES = config.capabilities.statusDefaultPurposes;
  const CANCEL_ACCEPTED_MESSAGE =
    'Queued items are cancelled. An item already processing may still be issued. Cancellation does not revoke any credentials.';
  const BODY_NOT_ALLOWED_MESSAGE = 'Send this request without a body.';
  const NOT_CANCELLABLE_MESSAGE = 'This credential batch cannot be cancelled because it has already settled.';
  const NOT_FOUND_BODY = { error: 'Credential batch not found.' };
  const BATCH_ITEM_COUNT = 5;
  const LARGE_BATCH_ITEM_COUNT = 40;
  const POLL_INTERVAL_MS = 100;
  const POLL_TIMEOUT_MS = 120_000;
  let issuerDid: string;
  let foreignDid: string;
  let foreignBatchId: string;

  const credentialFixture: CredentialRequestFixture = {
    runId: RUN_ID,
    context: ['https://www.w3.org/ns/credentials/v2', 'https://test.uncefact.org/vocabulary/untp/dpp/0.6.1/'],
    credentialType: CREDENTIAL_TYPE,
    version: CREDENTIAL_VERSION,
    statusPurposes: STATUS_PURPOSES,
    credentialIdPrefix: 'e2e-batch-cancel',
    issuerNamePrefix: 'E2E Batch Cancellation Issuer',
    subjectIdPrefix: 'e2e-batch-cancel',
  };

  type BatchRequest = {
    items: CredentialRequest[];
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
    cancelRequestedAt: string | null;
    settledAt: string | null;
    items: BatchItem[];
    message?: string;
  };

  type SubmittedBatch = {
    batchId: string;
    statusUrl: string;
  };

  function buildBatchRequest(issuer: string, label: string, count = BATCH_ITEM_COUNT): BatchRequest {
    return {
      items: Array.from({ length: count }, (_, index) =>
        buildCredentialRequest(credentialFixture, issuer, `${label}-${index}`),
      ),
    };
  }

  function submitBatch(
    idempotencyKey: string,
    requestBody: BatchRequest,
    accessToken?: string,
  ): Cypress.Chainable<SubmittedBatch> {
    const headers = {
      'Idempotency-Key': idempotencyKey,
      ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
    };

    return cy
      .request({ method: 'POST', url: '/api/v1/credentials/batches', headers, body: requestBody })
      .then((response) => {
        expect(response.status, 'batch submission status').to.eq(202);
        expect(response.body.batchId, 'submitted batch id').to.be.a('string').and.not.empty;
        expect(response.body.status, 'submitted batch status URL').to.match(/^\/api\/v1\/credentials\/batches\/.+/);
        expect(response.headers.location, 'batch Location header').to.eq(response.body.status);
        return { batchId: response.body.batchId as string, statusUrl: response.body.status as string };
      });
  }

  function waitForActiveBatch(statusUrl: string, timeoutMs = POLL_TIMEOUT_MS): Cypress.Chainable<BatchStatus> {
    const startedAt = Date.now();

    const poll = (): Cypress.Chainable<BatchStatus> => {
      const request = cy.request({ method: 'GET', url: statusUrl, failOnStatusCode: false }).then((response) => {
        const body = response.body as BatchStatus;
        expect(response.status, `GET ${statusUrl} status`).to.eq(200);

        if (body.state === 'COMPLETED' || body.state === 'CANCELLED' || body.state === 'NEEDS_ATTENTION') {
          throw new Error(`Batch settled before an active item was observed; last response: ${JSON.stringify(body)}`);
        }
        expect(body.state, `active batch state for ${statusUrl}`).to.be.oneOf(['QUEUED', 'RUNNING']);

        if (body.items.some((item) => item.state === 'PROCESSING' || item.state === 'ISSUED')) return body;
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(`Timed out waiting for an active batch item; last response: ${JSON.stringify(body)}`);
        }

        return cy.wait(POLL_INTERVAL_MS).then(poll);
      });
      return request as unknown as Cypress.Chainable<BatchStatus>;
    };

    return poll();
  }

  function waitForBatchSettlement(
    statusUrl: string,
    acceptedStates: string[],
    inspect?: (body: BatchStatus) => void,
    timeoutMs = POLL_TIMEOUT_MS,
  ): Cypress.Chainable<BatchStatus> {
    const startedAt = Date.now();

    const poll = (): Cypress.Chainable<BatchStatus> => {
      const request = cy.request({ method: 'GET', url: statusUrl, failOnStatusCode: false }).then((response) => {
        const body = response.body as BatchStatus;
        expect(response.status, `GET ${statusUrl} status`).to.eq(200);
        inspect?.(body);

        if (acceptedStates.includes(body.state)) return body;
        if (body.state === 'NEEDS_ATTENTION') {
          throw new Error(`Batch settled as NEEDS_ATTENTION; last response: ${JSON.stringify(body)}`);
        }
        expect(body.state, `unsettled batch state for ${statusUrl}`).to.be.oneOf(['QUEUED', 'RUNNING']);
        if (Date.now() - startedAt >= timeoutMs) {
          throw new Error(`Timed out waiting for batch settlement; last response: ${JSON.stringify(body)}`);
        }

        return cy.wait(POLL_INTERVAL_MS).then(poll);
      });
      return request as unknown as Cypress.Chainable<BatchStatus>;
    };

    return poll();
  }

  function assertCancelAccepted(response: Cypress.Response<BatchStatus>, total: number): BatchStatus {
    expect(response.status, 'cancel status').to.eq(202);
    const body = response.body;
    expect(body.message, 'cancel message').to.eq(CANCEL_ACCEPTED_MESSAGE);
    expect(body.cancelRequestedAt, 'cancelRequestedAt').to.be.a('string').and.not.empty;
    expect(Date.parse(body.cancelRequestedAt as string), 'cancelRequestedAt timestamp').to.not.be.NaN;
    expect(body.counts.total, 'cancel total').to.eq(total);
    expect(body.counts.queued, 'queued count after cancel').to.eq(0);
    expect(
      body.counts.cancelled + body.counts.processing + body.counts.issued + body.counts.failed + body.counts.unknown,
      'cancelled, processing and settled counts after cancel',
    ).to.eq(total);
    expect(body.items, 'cancel item count').to.have.length(total);
    return body;
  }

  function assertCancelledSettlement(status: BatchStatus, total: number, label: string): void {
    expect(status.state, `${label} state`).to.eq('CANCELLED');
    expect(status.counts.total, `${label} total`).to.eq(total);
    expect(status.counts.queued, `${label} queued count`).to.eq(0);
    expect(status.counts.processing, `${label} processing count`).to.eq(0);
    expect(status.counts.cancelled, `${label} cancelled count`).to.be.greaterThan(0);
    expect(
      status.counts.issued + status.counts.cancelled + status.counts.failed + status.counts.unknown,
      `${label} outcome counts`,
    ).to.eq(total);
    expect(status.items, `${label} item count`).to.have.length(total);
  }

  function assertSettledItems(status: BatchStatus, requestBody: BatchRequest, label: string) {
    expect(
      status.items.map((item) => item.index),
      `${label} item indexes`,
    ).to.deep.eq(requestBody.items.map((_, index) => index));

    let chain = cy.wrap(undefined);
    status.items.forEach((item) => {
      chain = chain.then(() => {
        if (item.state === 'ISSUED') {
          return assertIssuedCredential(item, requestBody.items[item.index], {
            label: `${label} item ${item.index}`,
            expectedIssuer: issuerDid,
            statusPurposes: STATUS_PURPOSES,
          });
        }
        expect(item.state, `${label} item ${item.index} state`).to.be.oneOf(['CANCELLED', 'FAILED', 'OUTCOME_UNKNOWN']);
        if (item.state === 'CANCELLED') {
          expect(item, `${label} cancelled item ${item.index} credentialId`).to.not.have.property('credentialId');
        }
        return undefined;
      }) as unknown as Cypress.Chainable<undefined>;
    });
    return chain;
  }

  function assertRunningCancellationSettlement(status: BatchStatus, total: number): void {
    expect(status.counts.total, 'settled batch total').to.eq(total);
    expect(status.counts.queued, 'settled queued count').to.eq(0);
    expect(status.counts.processing, 'settled processing count').to.eq(0);
    expect(
      status.counts.issued + status.counts.cancelled + status.counts.failed + status.counts.unknown,
      'settled outcome counts',
    ).to.eq(total);
    expect(status.items).to.have.length(total);

    if (status.state === 'CANCELLED') {
      expect(status.counts.cancelled).to.be.greaterThan(0);
      return;
    }

    expect(status.state, 'all-issued cancellation settlement state').to.eq('COMPLETED');
    expect(status.counts.cancelled, 'all-issued cancelled count').to.eq(0);
    status.items.forEach((item) => expect(item.state, `settled item ${item.index} state`).to.not.eq('CANCELLED'));
  }

  before(() => {
    cy.task('getServiceAccountToken', config.serviceAccounts.sa2).then((result: any) => {
      cy.request({
        method: 'POST',
        url: '/api/v1/dids',
        headers: { Authorization: `Bearer ${result.accessToken}` },
        body: {
          type: 'MANAGED',
          method: 'DID_WEB',
          alias: `e2e-batch-cancel-foreign-did-${RUN_ID}`,
          name: `E2E Batch cancellation foreign tenant DID ${RUN_ID}`,
        },
      }).then((response) => {
        expect(response.status).to.eq(201);
        foreignDid = response.body.did;

        return submitBatch(
          `e2e-batch-cancel-foreign-${RUN_ID}`,
          { items: [buildCredentialRequest(credentialFixture, foreignDid, 'foreign-batch')] },
          result.accessToken,
        ).then(({ batchId }) => {
          foreignBatchId = batchId;
        });
      });
    });

    cy.apiLogin();

    cy.request({
      method: 'POST',
      url: '/api/v1/services',
      body: {
        serviceType: 'VC',
        adapterType: 'VCKIT',
        name: `E2E Batch Cancellation VCKit VC ${RUN_ID}`,
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
        name: `E2E Batch Cancellation Storage ${RUN_ID}`,
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
      const defaultDid = response.body.data.find((did: Record<string, any>) => did.isDefault === true);
      expect(defaultDid, 'A default DID must be configured for the batch cancellation issuer').to.exist;
      issuerDid = defaultDid.did;
    });
  });

  it('cancels a running batch and proves issued and cancelled outcomes', () => {
    const requestBody = buildBatchRequest(issuerDid, 'running');

    submitBatch(`e2e-batch-cancel-running-${RUN_ID}`, requestBody)
      .then(({ statusUrl }) => waitForActiveBatch(statusUrl).then((active) => ({ statusUrl, active })))
      .then(({ statusUrl, active }) => {
        expect(active.items.some((item) => item.state === 'PROCESSING' || item.state === 'ISSUED')).to.eq(true);
        return cy.request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false }).then((response) => {
          const accepted = assertCancelAccepted(response, BATCH_ITEM_COUNT);
          return waitForBatchSettlement(statusUrl, ['CANCELLED', 'COMPLETED']).then((settled) => ({
            accepted,
            settled,
          }));
        });
      })
      .then(({ accepted, settled }) => {
        expect(settled.cancelRequestedAt, 'settlement cancelRequestedAt').to.eq(accepted.cancelRequestedAt);
        assertRunningCancellationSettlement(settled, BATCH_ITEM_COUNT);
        return assertSettledItems(settled, requestBody, 'running cancellation');
      });
  });

  it('accepts a second cancel while the batch is still running with the first timestamp', () => {
    const requestBody = buildBatchRequest(issuerDid, 'second-cancel');

    submitBatch(`e2e-batch-cancel-second-${RUN_ID}`, requestBody)
      .then(({ statusUrl }) => waitForActiveBatch(statusUrl).then(() => statusUrl))
      .then((statusUrl) =>
        cy
          .request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false })
          .then((firstResponse) => ({ statusUrl, first: assertCancelAccepted(firstResponse, BATCH_ITEM_COUNT) })),
      )
      .then(({ statusUrl, first }) => {
        expect(first.state, 'first cancel must observe a running batch').to.eq('RUNNING');
        return cy
          .request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false })
          .then((secondResponse) => {
            expect(secondResponse.status, 'second cancel status').to.eq(202);
            expect(secondResponse.body.message, 'second cancel message').to.eq(CANCEL_ACCEPTED_MESSAGE);
            expect(secondResponse.body.cancelRequestedAt, 'second cancelRequestedAt').to.eq(first.cancelRequestedAt);
            return waitForBatchSettlement(statusUrl, ['CANCELLED', 'COMPLETED']);
          });
      })
      .then((settled) => {
        assertRunningCancellationSettlement(settled, BATCH_ITEM_COUNT);
        return assertSettledItems(settled, requestBody, 'second cancellation');
      });
  });

  it('refuses cancellation after settlement without changing the projection', () => {
    const requestBody = buildBatchRequest(issuerDid, 'settled', 1);

    submitBatch(`e2e-batch-cancel-settled-${RUN_ID}`, requestBody)
      .then(({ statusUrl }) => waitForBatchSettlement(statusUrl, ['COMPLETED']).then(() => statusUrl))
      .then((statusUrl) =>
        cy.request({ method: 'GET', url: statusUrl }).then((beforeResponse) => ({ statusUrl, beforeResponse })),
      )
      .then(({ statusUrl, beforeResponse }) => {
        expect(beforeResponse.status, 'settled projection before refusal').to.eq(200);
        expect(beforeResponse.body.state, 'settled state before refusal').to.eq('COMPLETED');
        return cy
          .request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false })
          .then((cancelResponse) => ({ statusUrl, beforeProjection: beforeResponse.body, cancelResponse }));
      })
      .then(({ statusUrl, beforeProjection, cancelResponse }) => {
        expect(cancelResponse.status, 'settled cancel status').to.eq(409);
        expect(cancelResponse.body).to.deep.eq({ error: NOT_CANCELLABLE_MESSAGE, code: 'BATCH_NOT_CANCELLABLE' });
        return cy.request({ method: 'GET', url: statusUrl }).then((afterResponse) => {
          expect(afterResponse.status, 'settled projection after refusal').to.eq(200);
          expect(afterResponse.body).to.deep.eq(beforeProjection);
        });
      });
  });

  it('cancels a large batch while work remains queued', () => {
    const requestBody = buildBatchRequest(issuerDid, 'queued', LARGE_BATCH_ITEM_COUNT);

    submitBatch(`e2e-batch-cancel-queued-${RUN_ID}`, requestBody)
      .then(({ statusUrl }) =>
        cy.request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false }).then((response) => ({
          statusUrl,
          accepted: assertCancelAccepted(response, LARGE_BATCH_ITEM_COUNT),
        })),
      )
      .then(({ statusUrl, accepted }) => {
        expect(accepted.cancelRequestedAt, 'queued cancellation timestamp').to.be.a('string').and.not.empty;
        return waitForBatchSettlement(statusUrl, ['CANCELLED']);
      })
      .then((settled) => {
        assertCancelledSettlement(settled, LARGE_BATCH_ITEM_COUNT, 'queued cancellation');
        return assertSettledItems(settled, requestBody, 'queued cancellation');
      });
  });

  it('refuses cancellation of a completed batch', () => {
    const requestBody = buildBatchRequest(issuerDid, 'completed', 1);

    submitBatch(`e2e-batch-cancel-completed-${RUN_ID}`, requestBody)
      .then(({ statusUrl }) => waitForBatchSettlement(statusUrl, ['COMPLETED']).then(() => statusUrl))
      .then((statusUrl) => cy.request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false }))
      .then((response) => {
        expect(response.status, 'completed cancel status').to.eq(409);
        expect(response.body).to.deep.eq({ error: NOT_CANCELLABLE_MESSAGE, code: 'BATCH_NOT_CANCELLABLE' });
      });
  });

  it('refuses unknown, foreign and bodyful cancellation requests', () => {
    const unknownBatchUrl = `/api/v1/credentials/batches/unknown-${RUN_ID}`;
    const bodyRequest = buildBatchRequest(issuerDid, 'body-refusal', 1);

    cy.request({ method: 'POST', url: `${unknownBatchUrl}/cancel`, failOnStatusCode: false })
      .then((unknownResponse) => {
        expect(unknownResponse.status, 'unknown batch cancel status').to.eq(404);
        expect(unknownResponse.body).to.deep.eq(NOT_FOUND_BODY);
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: `/api/v1/credentials/batches/${foreignBatchId}`,
          failOnStatusCode: false,
        }),
      )
      .then((foreignGetResponse) => {
        expect(foreignGetResponse.status, 'foreign batch GET status').to.eq(404);
        expect(foreignGetResponse.body, 'foreign batch GET body').to.deep.eq(NOT_FOUND_BODY);
        return cy.request({
          method: 'POST',
          url: `/api/v1/credentials/batches/${foreignBatchId}/cancel`,
          failOnStatusCode: false,
        });
      })
      .then((foreignResponse) => {
        expect(foreignResponse.status, 'foreign batch cancel status').to.eq(404);
        expect(foreignResponse.body).to.deep.eq(NOT_FOUND_BODY);
      })
      .then(() => submitBatch(`e2e-batch-cancel-body-${RUN_ID}`, bodyRequest))
      .then(({ statusUrl }) =>
        cy
          .request({ method: 'POST', url: `${statusUrl}/cancel`, body: {}, failOnStatusCode: false })
          .then((emptyObjectResponse) => {
            expect(emptyObjectResponse.status, 'empty object cancel status').to.eq(400);
            expect(emptyObjectResponse.body).to.deep.eq({ error: BODY_NOT_ALLOWED_MESSAGE });
          })
          .then(() => cy.request({ method: 'POST', url: `${statusUrl}/cancel`, body: 'x', failOnStatusCode: false }))
          .then((stringResponse) => {
            expect(stringResponse.status, 'string body cancel status').to.eq(400);
            expect(stringResponse.body).to.deep.eq({ error: BODY_NOT_ALLOWED_MESSAGE });
          }),
      );
  });

  it('replays the cancelled batch for the same key and rejects a changed body', () => {
    const idempotencyKey = `e2e-batch-cancel-replay-${RUN_ID}`;
    const requestBody = buildBatchRequest(issuerDid, 'replay', LARGE_BATCH_ITEM_COUNT);
    const changedBody = buildBatchRequest(issuerDid, 'replay-changed', LARGE_BATCH_ITEM_COUNT);

    submitBatch(idempotencyKey, requestBody)
      .then(({ batchId, statusUrl }) =>
        cy.request({ method: 'POST', url: `${statusUrl}/cancel`, failOnStatusCode: false }).then((response) => ({
          batchId,
          statusUrl,
          accepted: assertCancelAccepted(response, LARGE_BATCH_ITEM_COUNT),
        })),
      )
      .then(({ batchId, statusUrl }) => {
        return waitForBatchSettlement(statusUrl, ['CANCELLED']).then((settled) => ({ batchId, statusUrl, settled }));
      })
      .then(({ batchId, statusUrl, settled }) => {
        assertCancelledSettlement(settled, LARGE_BATCH_ITEM_COUNT, 'replay cancellation');
        return assertSettledItems(settled, requestBody, 'replay cancellation').then(() =>
          cy
            .request({
              method: 'POST',
              url: '/api/v1/credentials/batches',
              headers: { 'Idempotency-Key': idempotencyKey },
              body: requestBody,
              failOnStatusCode: false,
            })
            .then((replayResponse) => {
              expect(replayResponse.status, 'cancelled replay status').to.eq(202);
              expect(replayResponse.body.batchId, 'cancelled replay batch id').to.eq(batchId);
              expect(replayResponse.body.status, 'cancelled replay status URL').to.eq(statusUrl);
              return cy.request({
                method: 'POST',
                url: '/api/v1/credentials/batches',
                headers: { 'Idempotency-Key': idempotencyKey },
                body: changedBody,
                failOnStatusCode: false,
              });
            }),
        );
      })
      .then((changedResponse) => {
        expect(changedResponse.status, 'changed replay status').to.eq(422);
        expect(changedResponse.body.code, 'changed replay error code').to.eq('IDEMPOTENCY_KEY_MISMATCH');
      });
  });
});
