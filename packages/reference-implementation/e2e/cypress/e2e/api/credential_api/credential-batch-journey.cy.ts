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
  // The resolver has no listing to sweep, so this reuses the one namespace the
  // harness ledger in cypress.config.ts retires even after a killed run.
  const PUBLISH_NAMESPACE = `e2e-pub-${RUN_ID}`;
  const PUBLISH_PRIMARY_KEY = `arn-batch-${RUN_ID}`;
  const idrAuthHeaders = { Authorization: `Bearer ${config.services.idr.apiKey}` };
  let issuerDid: string;
  let foreignDid: string;
  let publishNamespaceRegistered = false;

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
    statusPurposes?: string[];
  };

  function buildCredentialRequest(
    issuer: string,
    label: string,
    statusPurposes = STATUS_PURPOSES,
  ): Cypress.Chainable<CredentialRequest> {
    return readV070CredentialPayload({
      templateDir: 'digital_product_passport',
      credentialId: `urn:uuid:e2e-batch-${label}-${RUN_ID}`,
      credentialName: `E2E batch credential ${label} ${RUN_ID}`,
      issuerDid: issuer,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    }).then((credentialPayload) => ({
      credentialPayload,
      credentialType: CREDENTIAL_TYPE,
      version: CREDENTIAL_VERSION,
      statusPurposes,
    }));
  }

  function buildBatchRequest(specs: CredentialRequestSpec[]): Cypress.Chainable<BatchRequest> {
    return specs
      .reduce(
        (chain, spec) =>
          chain.then((items) =>
            buildCredentialRequest(spec.issuer, spec.label, spec.statusPurposes).then((item) => [
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

  after(() => {
    if (!publishNamespaceRegistered) return;
    // Pyx IDR v4 deletes one namespace through the query parameter, and
    // answers 400 "not found" for a namespace it no longer holds.
    cy.request({
      method: 'DELETE',
      url: `${config.services.idr.publicBaseUrl}/api/v4/identifiers`,
      headers: idrAuthHeaders,
      qs: { namespace: PUBLISH_NAMESPACE },
      failOnStatusCode: false,
    }).then((response) => {
      const alreadyRetired = response.status === 400 && /not found/i.test(JSON.stringify(response.body));
      expect(
        alreadyRetired || [200, 204, 404].includes(response.status),
        `resolver namespace delete status ${response.status}`,
      ).to.eq(true);
    });
  });

  it('submits an ordered batch, waits for completion, and proves every item was issued', () => {
    const idempotencyKey = `e2e-batch-journey-${RUN_ID}`;
    const references = [`PO-${RUN_ID}-0`, `PO-${RUN_ID}-1`];
    buildBatchRequest([
      { issuer: issuerDid, label: 'valid-0', reference: references[0], statusPurposes: ['revocation'] },
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
          statusPurposes: ['revocation'],
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

  it('manages status and deletes a credential issued by its own batch', () => {
    const retry = Cypress.currentRetry;
    const idempotencyKey = `e2e-batch-journey-lifecycle-${RUN_ID}-r${retry}`;
    const label = `lifecycle-${retry}`;

    return buildBatchRequest([{ issuer: issuerDid, label, statusPurposes: ['revocation'] }])
      .then((requestBody) =>
        cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': idempotencyKey },
            body: requestBody,
          })
          .then((response) => {
            expect(response.status, 'lifecycle batch submission status').to.eq(202);
            expect(response.body.batchId, 'lifecycle batch id').to.be.a('string').and.not.empty;
            expect(response.body.status, 'lifecycle batch status URL').to.match(/^\/api\/v1\/credentials\/batches\/.+/);
            return waitForBatchCompletion(response.body.status).then((status) => {
              expect(status.state, 'lifecycle batch state').to.eq('COMPLETED');
              expect(status.counts).to.deep.eq({
                total: 1,
                queued: 0,
                processing: 0,
                issued: 1,
                failed: 0,
                unknown: 0,
                cancelled: 0,
              });
              expect(status.items, 'lifecycle batch item count').to.have.length(1);
              expect(status.items[0].state, 'lifecycle batch item state').to.eq('ISSUED');
              const credentialId = status.items[0].credentialId;
              expect(credentialId, 'lifecycle batch credential id').to.be.a('string').and.not.empty;
              return assertIssuedCredential(status.items[0], requestBody.items[0], {
                label: 'lifecycle item',
                expectedIssuer: issuerDid,
                statusPurposes: ['revocation'],
              }).then(() => credentialId as string);
            });
          }),
      )
      .then((credentialId) =>
        cy
          .request(`/api/v1/credentials/${credentialId}/status`)
          .then((statusResponse) => {
            expect(statusResponse.status, 'batch-issued status read').to.eq(200);
            const entry = statusResponse.body.entries.find(
              (candidate: { statusPurpose?: string }) => candidate.statusPurpose === 'revocation',
            ) as { version?: number } | undefined;
            expect(entry, 'batch-issued revocation entry').to.exist;
            expect(entry!.version, 'batch-issued revocation version').to.be.a('number').and.greaterThan(0);

            return cy.request({
              method: 'PUT',
              url: `/api/v1/credentials/${credentialId}/status/revocation`,
              headers: { 'If-Version': String(entry!.version) },
              body: { value: true },
              failOnStatusCode: false,
            });
          })
          .then((statusResponse) => {
            if (config.capabilities.statusMutationEnabled) {
              expect(statusResponse.status, 'batch-issued revocation status').to.eq(200);
              expect(statusResponse.body).to.include({ statusPurpose: 'revocation', value: true });
              expect(statusResponse.body.observedAt, 'batch-issued observedAt').to.be.a('string');
              expect(statusResponse.body.version, 'batch-issued status version').to.be.a('number');
              return cy.request(`/api/v1/library/${credentialId}`).then((libraryResponse) => {
                expect(libraryResponse.status, 'revoked batch-issued library status').to.eq(200);
                expect(libraryResponse.body.lifecycle, 'revoked batch-issued lifecycle').to.eq('revoked');
              });
            }

            expect(statusResponse.status, 'disabled batch-issued status mutation').to.eq(503);
            expect(statusResponse.body.code, 'disabled batch-issued status mutation code').to.eq(
              'STATUS_MUTATION_DISABLED',
            );
            return cy.request(`/api/v1/credentials/${credentialId}/status`).then((readResponse) => {
              expect(readResponse.status, 'status remains readable when mutation is disabled').to.eq(200);
            });
          })
          .then(() =>
            cy.request({ method: 'DELETE', url: `/api/v1/credentials/${credentialId}` }).then((deleteResponse) => {
              expect(deleteResponse.status, 'batch-issued native delete status').to.eq(204);
              return cy.request({
                method: 'GET',
                url: `/api/v1/library/${credentialId}`,
                failOnStatusCode: false,
              });
            }),
          )
          .then((libraryResponse) => {
            expect(libraryResponse.status, 'deleted batch-issued library status').to.eq(404);
          }),
      );
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

  // Catches a worker that cannot publish with the default human verification
  // link. Without RI_APP_URL the worker refuses to boot and this batch never
  // settles. Without that boot check it fails the item with
  // ITEM_ATTEMPTS_EXHAUSTED.
  it('publishes a batch item with the default human verification link', () => {
    const retry = Cypress.currentRetry;
    const label = `publish-${retry}`;
    const identifierValue = `${RUN_ID}-batch-publish-r${retry}`;
    type IdrLink = { mimeType?: string; targetUrl: string };

    cy.request({
      method: 'POST',
      url: '/api/v1/registrars',
      body: {
        name: `E2E Batch Publishing Registrar ${RUN_ID}`,
        namespace: PUBLISH_NAMESPACE,
        url: `https://registrar-${RUN_ID}.example.com`,
      },
    })
      .then((registrarResponse) => {
        expect(registrarResponse.status, 'publishing registrar status').to.eq(201);
        return cy.request({
          method: 'POST',
          url: '/api/v1/schemes',
          body: {
            registrarId: registrarResponse.body.id,
            name: `E2E Batch ARN Scheme ${RUN_ID}`,
            primaryKey: PUBLISH_PRIMARY_KEY,
            validationPattern: '^e2e-\\d{10,}.*$',
            linkTemplate: '/{primaryKey}/{value}',
          },
        });
      })
      .then((schemeResponse) => {
        expect(schemeResponse.status, 'publishing scheme status').to.eq(201);
        return cy.request({
          method: 'POST',
          url: '/api/v1/identifiers',
          body: { schemeId: schemeResponse.body.id, value: identifierValue },
        });
      })
      .then((identifierResponse) => {
        expect(identifierResponse.status, 'publishing identifier status').to.eq(201);
        publishNamespaceRegistered = true;
        return cy.request({
          method: 'POST',
          url: `${config.services.idr.publicBaseUrl}/api/v4/identifiers`,
          headers: idrAuthHeaders,
          body: {
            namespace: PUBLISH_NAMESPACE,
            applicationIdentifiers: [
              {
                title: `E2E Batch ARN ${RUN_ID}`,
                label: 'ARN',
                shortcode: PUBLISH_PRIMARY_KEY,
                ai: PUBLISH_PRIMARY_KEY,
                type: 'I',
                regex: '^e2e-\\d{10,}.*$',
              },
            ],
          },
        });
      })
      .then((namespaceResponse) => {
        expect(namespaceResponse.status, 'resolver namespace status').to.be.oneOf([200, 201]);
        return buildCredentialRequest(issuerDid, label, ['revocation']);
      })
      .then((baseItem) => {
        // The v0.7.0 DPP bridge publishes under the product's model number.
        const requestItem: CredentialRequest & { publishingOptions: { publish: boolean } } = {
          ...baseItem,
          credentialPayload: {
            ...baseItem.credentialPayload,
            credentialSubject: { ...baseItem.credentialPayload.credentialSubject, modelNumber: identifierValue },
          },
          publishingOptions: { publish: true },
        };
        return cy
          .request({
            method: 'POST',
            url: '/api/v1/credentials/batches',
            headers: { 'Idempotency-Key': `e2e-batch-publish-${RUN_ID}-r${retry}` },
            body: { items: [requestItem] },
          })
          .then((response) => {
            expect(response.status, 'publishing batch submission status').to.eq(202);
            expect(response.body.batchId, 'publishing batch id').to.be.a('string').and.not.empty;
            return waitForBatchCompletion(response.body.status).then((status) => ({ status, requestItem }));
          });
      })
      .then(({ status, requestItem }) => {
        expect(status.state, 'publishing batch state').to.eq('COMPLETED');
        expect(status.counts).to.deep.eq({
          total: 1,
          queued: 0,
          processing: 0,
          issued: 1,
          failed: 0,
          unknown: 0,
          cancelled: 0,
        });
        expect(status.items, 'publishing batch item count').to.have.length(1);
        const [item] = status.items;
        expect(item.state, `publishing batch item ${JSON.stringify(item)}`).to.eq('ISSUED');
        expect(item, `publishing batch item warning ${JSON.stringify(item.warning)}`).not.to.have.property('warning');
        return assertIssuedCredential(item, requestItem, {
          label: 'publishing item',
          expectedIssuer: issuerDid,
          statusPurposes: ['revocation'],
        });
      })
      .then(() =>
        cy.request({
          method: 'GET',
          url: `${config.services.idr.publicBaseUrl}/api/v4/resolver/links`,
          headers: idrAuthHeaders,
          qs: {
            namespace: PUBLISH_NAMESPACE,
            identificationKeyType: PUBLISH_PRIMARY_KEY,
            identificationKey: identifierValue,
          },
        }),
      )
      .then((linksResponse) => {
        expect(linksResponse.status, 'resolver links status').to.eq(200);
        const links = linksResponse.body as IdrLink[];
        expect(links, JSON.stringify(links)).to.have.length(2);
        expect(
          links.find((link) => link.mimeType === 'application/json'),
          'credential link',
        ).to.exist;

        const humanLink = links.find((link) => link.mimeType === 'text/html');
        expect(humanLink, 'human verification link').to.exist;
        const target = new URL((humanLink as IdrLink).targetUrl);
        const verifyPage = new URL('/verify', Cypress.config('baseUrl') as string);
        expect(target.origin, 'human link origin').to.eq(verifyPage.origin);
        expect(target.pathname, 'human link path').to.eq(verifyPage.pathname);
      });
  });

  it('gives each record of a batch the tags its own item carried', () => {
    const retry = Cypress.currentRetry;
    const itemTags = [['e2e-batch-a'], ['e2e-batch-b', 'e2e-batch-c']];

    return buildBatchRequest([
      { issuer: issuerDid, label: `tags-0-${retry}` },
      { issuer: issuerDid, label: `tags-1-${retry}` },
    ])
      .then((requestBody) =>
        cy.request({
          method: 'POST',
          url: '/api/v1/credentials/batches',
          headers: { 'Idempotency-Key': `e2e-batch-tags-${RUN_ID}-r${retry}` },
          body: { items: requestBody.items.map((item, index) => ({ ...item, tags: itemTags[index] })) },
        }),
      )
      .then((response) => {
        expect(response.status, 'tagged batch submission status').to.eq(202);
        return waitForBatchCompletion(response.body.status);
      })
      .then((status) => {
        expect(
          status.items.map((item) => item.state),
          'tagged batch item states',
        ).to.deep.eq(['ISSUED', 'ISSUED']);
        const ids = status.items.map((item) => item.credentialId as string);
        return cy
          .request({ method: 'POST', url: '/api/v1/library/batch-get', body: { ids } })
          .then((response) => ({ response, ids }));
      })
      .then(({ response, ids }) => {
        expect(response.status, 'batch-get status').to.eq(200);
        expect(response.body.failures, 'batch-get failures').to.deep.eq([]);
        const records = response.body.data as { id: string; tags: string[]; tagVersion: number }[];
        ids.forEach((id, index) => {
          const record = records.find((candidate) => candidate.id === id);
          expect(record, `library record for item ${index}`).to.exist;
          expect(record!.tags, `tags on the record for item ${index}`).to.deep.eq(itemTags[index]);
          expect(record!.tagVersion, `tag version on the record for item ${index}`).to.eq(1);
        });
      });
  });
});
