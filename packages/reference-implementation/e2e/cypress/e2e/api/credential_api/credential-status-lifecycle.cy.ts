import { config, runnerReachableUri, runTag } from '../../../support/config';
import { expectStatusListIndex, decodeStoredCredential, unwrapEnvelope } from '../../../support/stored-credential';

type StatusEntry = {
  entryId: string;
  statusPurpose: string;
  value: boolean | null;
  observedAt: string | null;
  valueChangedAt: string | null;
  version: number;
  statusListIndex: string;
  statusListCredential: string;
  pending: Record<string, unknown> | null;
};

type StatusRead = {
  capture: string;
  statusCaptureError: string | null;
  attribution: { instanceId: string; source: string | null; at: string | null } | null;
  entries: StatusEntry[];
  observed?: Array<{
    entryId: string;
    statusPurpose: string;
    value: boolean;
    observedAt: string;
  }>;
  failures?: Array<{ entryId: string; statusPurpose: string; code: string; message: string }>;
};

describe('Credential status lifecycle', { testIsolation: false }, () => {
  let RUN_ID = runTag();
  let defaultDidValue: string;
  let vcServiceInstanceId: string;

  beforeEach(() => {
    RUN_ID = `${runTag()}-r${Cypress.currentRetry}`;
  });

  before(() => {
    cy.apiLogin();
    cy.request('/api/v1/dids').then((response) => {
      expect(response.status).to.eq(200);
      const defaultDid = response.body.data.find((did: Record<string, any>) => did.isDefault === true);
      expect(defaultDid, 'A default DID must be configured for the tenant').to.exist;
      defaultDidValue = defaultDid.did;
      expect(defaultDid.serviceInstanceId, 'The default DID must name its service instance').to.be.a('string').and.not
        .empty;
      vcServiceInstanceId = defaultDid.serviceInstanceId;
    });
  });

  after(() => {
    cy.task('cleanupE2ERunData');
  });

  function issueCredential(label: string, statusPurposes?: string[]): Cypress.Chainable<string> {
    return cy.readFile('../src/templates/v0.7.0/digital_product_passport/example-data.json').then((source) => {
      const credentialPayload = JSON.parse(JSON.stringify(source)) as Record<string, any>;
      credentialPayload.id = `urn:uuid:e2e-status-${label}-${RUN_ID}`;
      credentialPayload.name = `E2E status ${label} ${RUN_ID}`;
      credentialPayload.issuer.id = defaultDidValue;
      credentialPayload.validFrom = '2026-01-01T00:00:00Z';
      credentialPayload.validUntil = '2036-01-01T00:00:00Z';

      return cy
        .request({
          method: 'POST',
          url: '/api/v1/credentials',
          body: {
            credentialPayload,
            credentialType: 'DigitalProductPassport',
            version: '0.7.0',
            ...(statusPurposes === undefined ? {} : { statusPurposes }),
            storageOptions: { encrypt: false },
          },
        })
        .then((response) => {
          expect(response.status).to.eq(201);
          expect(response.body.credentialId).to.be.a('string');
          return response.body.credentialId as string;
        });
    });
  }

  function getLibrary(id: string): Cypress.Chainable<Cypress.Response<Record<string, any>>> {
    return cy.request({ method: 'GET', url: `/api/v1/library/${id}` });
  }

  function getStatus(id: string, fresh = false): Cypress.Chainable<Cypress.Response<StatusRead>> {
    return cy.request({ method: 'GET', url: `/api/v1/credentials/${id}/status${fresh ? '?fresh=true' : ''}` });
  }

  function entryVersion(status: StatusRead, purpose: string): number {
    const entry = status.entries.find((candidate) => candidate.statusPurpose === purpose);
    expect(entry, `stored ${purpose} status entry`).to.exist;
    expect(entry!.version).to.be.a('number').and.to.be.greaterThan(0);
    return entry!.version;
  }

  function vckitHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.services.vckit.apiKey}`,
    };
  }

  function statusEntryFromSignedCopy(
    storedCopy: unknown,
    label: string,
  ): { entry: Record<string, unknown>; statusListIssuer: string } {
    const issuedCredential = decodeStoredCredential(storedCopy);
    const status = issuedCredential.credentialStatus;
    expect(status, `${label} signed credentialStatus shape`).to.be.an('object');
    expect(Array.isArray(status), `${label} signed credentialStatus array`).to.eq(false);
    expect(status.statusPurpose, `${label} signed status purpose`).to.eq('revocation');
    expectStatusListIndex(status.statusListIndex, `${label} signed status-list index`, 'signed');
    const issuer = issuedCredential.issuer;
    const statusListIssuer =
      typeof issuer === 'string'
        ? issuer
        : issuer !== null && typeof issuer === 'object' && typeof issuer.id === 'string'
          ? issuer.id
          : undefined;
    expect(statusListIssuer, `${label} signed status-list issuer`).to.be.a('string').and.not.empty;
    return { entry: status as Record<string, unknown>, statusListIssuer: statusListIssuer! };
  }

  function checkVckitStatus(status: { entry: Record<string, unknown>; statusListIssuer: string }) {
    return cy.request({
      method: 'POST',
      url: new URL('/agent/checkBitstringStatus', config.services.vckit.publicBaseUrl).toString(),
      headers: vckitHeaders(),
      body: {
        verifiableCredential: {
          credentialStatus: status.entry,
          issuer: { id: status.statusListIssuer },
        },
      },
    });
  }

  function findLibraryRecord(lifecycle: string, id: string, offset = 0, page = 0): Cypress.Chainable<boolean> {
    if (page >= 1000) throw new Error(`Library lifecycle search exceeded its page bound for ${id}.`);
    return cy
      .request(`/api/v1/library?lifecycle=${encodeURIComponent(lifecycle)}&offset=${offset}`)
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.pagination.limit, 'library filter page limit').to.be.a('number').and.greaterThan(0);
        expect(response.body.pagination.hasMore, 'library filter hasMore').to.be.a('boolean');
        const found = response.body.data.some((row: Record<string, unknown>) => row.id === id);
        if (found || response.body.pagination.hasMore !== true) return found;
        return findLibraryRecord(lifecycle, id, offset + response.body.pagination.limit, page + 1);
      });
  }

  it('captures the deployment default status purpose and projects an unobserved lifecycle', () => {
    issueCredential('capture').then((credentialId) => {
      getLibrary(credentialId).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.status.capture).to.eq('CAPTURED');
        expect(response.body.status.statusCaptureError).to.be.null;
        expect(response.body.status.entries).to.have.length(config.capabilities.statusDefaultPurposes.length);
        expect(response.body.status.entries.map((entry: StatusEntry) => entry.statusPurpose)).to.deep.eq(
          config.capabilities.statusDefaultPurposes,
        );
        response.body.status.entries.forEach((entry: any) => {
          expectStatusListIndex(entry.statusListIndex, `integer ${entry.statusPurpose} statusListIndex`, 'stored');
          expect(entry.statusListCredential).to.be.a('string');
        });
        expect(response.body.lifecycle).to.eq(
          config.capabilities.statusDefaultPurposes.length === 0 ? 'none' : 'unknown',
        );
        expect(response.body.capabilities.statusManageable).to.eq(true);
        const storedCopyUrl = runnerReachableUri(response.body.storageUri);
        cy.request({ method: 'GET', url: storedCopyUrl }).then((storedCopyResponse) => {
          expect(storedCopyResponse.status).to.eq(200);
          const signedCredential = unwrapEnvelope(storedCopyResponse.body) as Record<string, unknown>;
          if (config.capabilities.statusDefaultPurposes.length === 0) {
            expect(signedCredential).to.not.have.property('credentialStatus');
            return;
          }
          const signedStatuses = Array.isArray(signedCredential.credentialStatus)
            ? signedCredential.credentialStatus
            : [signedCredential.credentialStatus];
          expect(signedStatuses.map((entry: any) => entry.statusPurpose)).to.deep.eq(
            config.capabilities.statusDefaultPurposes,
          );
        });
      });
    });
  });

  it('reads stored status facts with no-store caching and no live observations', () => {
    issueCredential('stored-read', ['revocation']).then((credentialId) => {
      getStatus(credentialId).then((response) => {
        expect(response.status).to.eq(200);
        expect(response.headers['cache-control']).to.eq('no-store');
        expect(response.body).to.not.have.property('observed');
        expect(response.body.attribution).to.not.be.null;
        const attribution = response.body.attribution!;
        expect(attribution.instanceId).to.eq(vcServiceInstanceId);
        expect(attribution.source).to.eq('ISSUANCE');
        expect(attribution.at).to.be.a('string');
        expect(Date.parse(attribution.at as string), 'status attribution timestamp').to.not.be.NaN;
        expect(response.body.entries).to.have.length(1);
        expect(response.body.entries[0].value).to.be.null;
      });
    });
  });

  it('returns live observations without changing stored versions or lifecycle', () => {
    issueCredential('fresh-read', ['revocation']).then((credentialId) => {
      getStatus(credentialId).then((storedBefore) => {
        const versionsBefore = storedBefore.body.entries.map((entry) => entry.version);
        getStatus(credentialId, true).then((fresh) => {
          expect(fresh.status).to.eq(200);
          expect(fresh.body.observed).to.have.length(1);
          expect(fresh.body.observed?.[0].statusPurpose).to.eq('revocation');
          expect(fresh.body.observed?.[0].entryId).to.eq(storedBefore.body.entries[0].entryId);
          expect(fresh.body.observed?.[0].value).to.eq(false);
          expect(Date.parse(fresh.body.observed?.[0].observedAt ?? ''), 'fresh observation timestamp').to.not.be.NaN;
          expect(fresh.body.failures, 'live provider read failures').to.deep.eq([]);
          getStatus(credentialId).then((storedAfter) => {
            expect(storedAfter.body.entries.map((entry) => entry.version)).to.deep.eq(versionsBefore);
            getLibrary(credentialId).then((library) => {
              // readCredentialStatus returns observations without persistence at lines 40-84;
              // deriveLifecycle therefore remains unknown until a mutation or reconciliation records facts.
              expect(library.body.lifecycle).to.eq('unknown');
            });
          });
        });
      });
    });
  });

  it('suspends and unsuspends through the provider and projects the confirmed lifecycle', function () {
    if (!config.capabilities.statusMutationEnabled) this.skip();

    issueCredential('suspension', ['suspension']).then((credentialId) => {
      getStatus(credentialId).then((stored) => {
        const initialVersion = entryVersion(stored.body, 'suspension');
        cy.request({
          method: 'PUT',
          url: `/api/v1/credentials/${credentialId}/status/suspension`,
          headers: { 'If-Version': String(initialVersion) },
          body: { value: true },
        }).then((suspendResponse) => {
          expect(suspendResponse.status).to.eq(200);
          expect(suspendResponse.body.value).to.eq(true);
          getStatus(credentialId, true).then((observedSuspended) => {
            expect(observedSuspended.body.observed).to.have.length(1);
            expect(observedSuspended.body.observed?.[0].statusPurpose).to.eq('suspension');
            expect(observedSuspended.body.observed?.[0].value).to.eq(true);
            expect(observedSuspended.body.failures).to.deep.eq([]);
            getLibrary(credentialId).then((suspended) => {
              expect(suspended.body.lifecycle).to.eq('suspended');
              const staleResponse = cy.request({
                method: 'PUT',
                url: `/api/v1/credentials/${credentialId}/status/suspension`,
                headers: { 'If-Version': String(initialVersion) },
                body: { value: false },
                failOnStatusCode: false,
              });
              staleResponse.then((response) => {
                expect(response.status).to.eq(409);
                expect(response.body.code).to.eq('VERSION_CONFLICT');
              });
              getStatus(credentialId).then((afterSuspend) => {
                const suspendedVersion = entryVersion(afterSuspend.body, 'suspension');
                cy.request({
                  method: 'PUT',
                  url: `/api/v1/credentials/${credentialId}/status/suspension`,
                  headers: { 'If-Version': String(suspendedVersion) },
                  body: { value: false },
                }).then((unsuspendResponse) => {
                  expect(unsuspendResponse.status).to.eq(200);
                  expect(unsuspendResponse.body.value).to.eq(false);
                  getStatus(credentialId, true).then((observedUnsuspended) => {
                    expect(observedUnsuspended.body.observed).to.have.length(1);
                    expect(observedUnsuspended.body.observed?.[0].statusPurpose).to.eq('suspension');
                    expect(observedUnsuspended.body.observed?.[0].value).to.eq(false);
                    expect(observedUnsuspended.body.failures).to.deep.eq([]);
                    getLibrary(credentialId).then((unsuspended) => {
                      expect(unsuspended.body.lifecycle).to.eq('none');
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });

  it('revokes irreversibly and refuses to clear the revocation', function () {
    if (!config.capabilities.statusMutationEnabled) this.skip();

    issueCredential('revocation', ['revocation']).then((credentialId) => {
      getStatus(credentialId).then((stored) => {
        const initialVersion = entryVersion(stored.body, 'revocation');
        cy.request({
          method: 'PUT',
          url: `/api/v1/credentials/${credentialId}/status/revocation`,
          headers: { 'If-Version': String(initialVersion) },
          body: { value: true },
        }).then((revokeResponse) => {
          expect(revokeResponse.status).to.eq(200);
          getLibrary(credentialId).then((revoked) => {
            expect(revoked.body.lifecycle).to.eq('revoked');
            findLibraryRecord('revoked', credentialId).then((foundInRevoked) => {
              expect(foundInRevoked, 'revoked lifecycle filter').to.eq(true);
              findLibraryRecord('none', credentialId).then((foundInNone) => {
                expect(foundInNone, 'none lifecycle filter').to.eq(false);
              });
            });
            getStatus(credentialId).then((afterRevoke) => {
              const revokedVersion = entryVersion(afterRevoke.body, 'revocation');
              cy.request({
                method: 'PUT',
                url: `/api/v1/credentials/${credentialId}/status/revocation`,
                headers: { 'If-Version': String(revokedVersion) },
                body: { value: false },
                failOnStatusCode: false,
              }).then((clearResponse) => {
                expect(clearResponse.status).to.eq(409);
                expect(clearResponse.body.code).to.eq('STATUS_IRREVERSIBLE');
                cy.request({
                  method: 'PUT',
                  url: `/api/v1/credentials/${credentialId}/status/suspension`,
                  headers: { 'If-Version': String(revokedVersion) },
                  body: { value: true },
                  failOnStatusCode: false,
                }).then((missingPurposeResponse) => {
                  expect(missingPurposeResponse.status).to.eq(404);
                  expect(missingPurposeResponse.body.code).to.eq('STATUS_ENTRY_NOT_FOUND');
                });
              });
            });
          });
        });
      });
    });
  });

  it('VCKit still reports the retained credential revoked after deletion', function () {
    if (!config.capabilities.statusMutationEnabled) this.skip();

    issueCredential('retained-list', ['revocation'])
      .then((credentialId) => {
        return getStatus(credentialId).then((stored) => {
          const initialVersion = entryVersion(stored.body, 'revocation');
          return cy
            .request({
              method: 'PUT',
              url: `/api/v1/credentials/${credentialId}/status/revocation`,
              headers: { 'If-Version': String(initialVersion) },
              body: { value: true },
            })
            .then((revokeResponse) => {
              expect(revokeResponse.status).to.eq(200);
              return getLibrary(credentialId);
            })
            .then((libraryResponse) => {
              const statusEntry = libraryResponse.body.status.entries.find(
                (entry: StatusEntry) => entry.statusPurpose === 'revocation',
              ) as StatusEntry | undefined;
              expect(statusEntry).to.exist;
              expectStatusListIndex(statusEntry!.statusListIndex, 'stored minted status-list index', 'stored');

              const statusListUrl = runnerReachableUri(statusEntry!.statusListCredential);
              const storedCopyUrl = runnerReachableUri(libraryResponse.body.storageUri);

              // Retain the stored copy in the runner before native deletion, because the DELETE
              // route removes its durable copy on a best-effort basis. The status list is the
              // independently published artefact whose availability is asserted after deletion.
              return cy.request({ method: 'GET', url: storedCopyUrl }).then((storedCopyResponse) => {
                expect(storedCopyResponse.status).to.eq(200);
                return { credentialId, statusListUrl, retainedCopy: storedCopyResponse.body };
              });
            });
        });
      })
      .then(({ credentialId, statusListUrl, retainedCopy }) => {
        const revokedStatus = statusEntryFromSignedCopy(retainedCopy, 'revoked');

        // The credential DELETE route is the native record's public deletion contract.
        return cy
          .request({ method: 'DELETE', url: `/api/v1/credentials/${credentialId}` })
          .then((deleteResponse) => {
            expect(deleteResponse.status).to.eq(204);
            return cy.request({
              method: 'GET',
              url: `/api/v1/credentials/${credentialId}/status`,
              failOnStatusCode: false,
            });
          })
          .then((statusResponse) => {
            expect(statusResponse.status).to.eq(404);
            expect(statusResponse.body.code).to.eq('NOT_FOUND');
            return checkVckitStatus(revokedStatus);
          })
          .then((vckitResponse) => {
            expect(vckitResponse.status).to.eq(200);
            expect(vckitResponse.body.revoked, 'VCKit retained credential status').to.eq(true);
            expect(vckitResponse.body.errors, 'VCKit retained credential status errors').to.deep.eq([]);
            return cy.request({ method: 'GET', url: statusListUrl, headers: vckitHeaders() });
          })
          .then((statusListResponse) => {
            expect(statusListResponse.status).to.eq(200);
            // The provider publishes the list as an enveloped credential;
            // the type lives on the inner credential.
            const statusList = unwrapEnvelope(statusListResponse.body) as Record<string, any>;
            const types = Array.isArray(statusList.type) ? statusList.type : [statusList.type];
            expect(types, 'status list inner type').to.include('BitstringStatusListCredential');
          });
      })
      .then(() => issueCredential('retained-list-control', ['revocation']))
      .then((controlCredentialId) => {
        return getLibrary(controlCredentialId).then((libraryResponse) => {
          expect(libraryResponse.status).to.eq(200);
          const storedCopyUrl = runnerReachableUri(libraryResponse.body.storageUri);
          return cy.request({ method: 'GET', url: storedCopyUrl }).then((storedCopyResponse) => {
            expect(storedCopyResponse.status).to.eq(200);
            return checkVckitStatus(statusEntryFromSignedCopy(storedCopyResponse.body, 'unrevoked control'));
          });
        });
      })
      .then((vckitResponse) => {
        expect(vckitResponse.status).to.eq(200);
        expect(vckitResponse.body.revoked, 'VCKit unrevoked control status').to.eq(false);
        expect(vckitResponse.body.errors, 'VCKit unrevoked control status errors').to.deep.eq([]);
      });
  });

  it('reports STATUS_MUTATION_DISABLED while keeping status reads available', function () {
    if (config.capabilities.statusMutationEnabled) this.skip();

    issueCredential('kill-switch', ['revocation']).then((credentialId) => {
      getStatus(credentialId).then((stored) => {
        const initialVersion = entryVersion(stored.body, 'revocation');
        cy.request({
          method: 'PUT',
          url: `/api/v1/credentials/${credentialId}/status/revocation`,
          headers: { 'If-Version': String(initialVersion) },
          body: { value: true },
          failOnStatusCode: false,
        }).then((response) => {
          expect(response.status).to.eq(503);
          expect(response.body.code).to.eq('STATUS_MUTATION_DISABLED');
          getStatus(credentialId).then((readResponse) => {
            expect(readResponse.status).to.eq(200);
          });
        });
      });
    });
  });

  it('refuses more than one status purpose by default', function () {
    if (config.capabilities.statusMultiplePurposesEnabled) this.skip();

    cy.readFile('../src/templates/v0.7.0/digital_product_passport/example-data.json').then((source) => {
      const credentialPayload = JSON.parse(JSON.stringify(source)) as Record<string, any>;
      credentialPayload.id = `urn:uuid:e2e-status-multiple-purposes-${RUN_ID}`;
      credentialPayload.name = `E2E status multiple purposes ${RUN_ID}`;
      credentialPayload.issuer.id = defaultDidValue;
      credentialPayload.validFrom = '2026-01-01T00:00:00Z';
      credentialPayload.validUntil = '2036-01-01T00:00:00Z';

      cy.request({
        method: 'POST',
        url: '/api/v1/credentials',
        body: {
          credentialPayload,
          credentialType: 'DigitalProductPassport',
          version: '0.7.0',
          statusPurposes: ['revocation', 'suspension'],
          storageOptions: { encrypt: false },
        },
        failOnStatusCode: false,
      }).then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.code).to.eq('VALIDATION_FAILED');
        expect(response.body.error).to.eq(
          'statusPurposes: only one status purpose can be issued while CREDENTIAL_STATUS_MULTIPLE_PURPOSES_ENABLED is false',
        );
      });
    });
  });
});
