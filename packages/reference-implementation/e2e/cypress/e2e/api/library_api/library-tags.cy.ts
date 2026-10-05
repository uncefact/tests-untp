import { config, runTag } from '../../../support/config';
import { readV070CredentialPayload } from '../../../support/v0.7-credential-payload';

const TAG_FORMAT_MESSAGE = 'must be lowercase letters and digits, with single hyphens between them';

describe('Library API tags', { testIsolation: false }, () => {
  // The run tag plus the attempt number, so a Cypress retry never reuses a
  // key, label or inclusion tag. The run tag matches the tag grammar, so each
  // test derives its own inclusion tag from it to scope its filtered reads to
  // the records it created, and the harness cleanup finds every record by it.
  let RUN_ID = runTag();
  beforeEach(() => {
    RUN_ID = `${runTag()}-r${Cypress.currentRetry}`;
  });
  const SA1 = config.serviceAccounts.sa1;
  const SA2 = config.serviceAccounts.sa2;
  const VALID_FROM = new Date().toISOString();
  const VALID_UNTIL = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toISOString();

  let token: string;
  let foreignToken: string;
  let issuerDid: string;

  function auth(bearer = token) {
    return { Authorization: `Bearer ${bearer}` };
  }

  function issueRequestBody(label: string, tags?: string[]): Cypress.Chainable<Record<string, any>> {
    return readV070CredentialPayload({
      templateDir: 'digital_product_passport',
      credentialId: `urn:uuid:e2e-library-tags-${label}-${RUN_ID}`,
      credentialName: `E2E library tags ${label} ${RUN_ID}`,
      issuerDid,
      validFrom: VALID_FROM,
      validUntil: VALID_UNTIL,
    }).then((credentialPayload) => ({
      credentialPayload,
      credentialType: 'DigitalProductPassport',
      version: '0.7.0',
      storageOptions: { encrypt: false },
      ...(tags === undefined ? {} : { tags }),
    }));
  }

  function issueCredential(label: string, tags?: string[]): Cypress.Chainable<string> {
    return issueRequestBody(label, tags).then((body) =>
      cy.request({ method: 'POST', url: '/api/v1/credentials', headers: auth(), body }).then((response) => {
        expect(response.status, `issue ${label}`).to.eq(201);
        expect(response.body.credentialId).to.be.a('string');
        return response.body.credentialId as string;
      }),
    );
  }

  function readRecord(id: string, bearer = token): Cypress.Chainable<Cypress.Response<any>> {
    return cy.request({ method: 'GET', url: `/api/v1/library/${id}`, headers: auth(bearer), failOnStatusCode: false });
  }

  /** Issues an unencrypted native credential and returns the stored copy's location, to register as a source. */
  function issueSource(label: string): Cypress.Chainable<string> {
    return issueCredential(`source-${label}`).then((credentialId) =>
      readRecord(credentialId).then((response) => {
        expect(response.status).to.eq(200);
        return response.body.storageUri as string;
      }),
    );
  }

  function registerBody(sourceUrl: string, label: string, tags?: string[]) {
    return {
      sourceUrl,
      annotations: { displayName: `E2E library tags ${label} ${RUN_ID}`, declaredCredentialType: 'DPP' },
      ...(tags === undefined ? {} : { tags }),
    };
  }

  function register(label: string, tags: string[]): Cypress.Chainable<Record<string, any>> {
    return issueSource(label).then((sourceUrl) =>
      cy
        .request({
          method: 'POST',
          url: '/api/v1/library',
          headers: { ...auth(), 'Idempotency-Key': `e2e-library-tags-${label}-${RUN_ID}` },
          body: registerBody(sourceUrl, label, tags),
        })
        .then((response) => {
          expect(response.status, `register ${label}`).to.eq(201);
          expect(response.body.origin).to.eq('external');
          expect(response.body.tags, `${label} tags in submitted order`).to.deep.eq(tags);
          expect(response.body.tagVersion).to.eq(1);
          expect(response.body.capabilities.taggable).to.eq(true);
          return response.body as Record<string, any>;
        }),
    );
  }

  function listQuery(params: Array<[string, string]>): string {
    return `/api/v1/library?${new URLSearchParams(params).toString()}`;
  }

  /**
   * Walks a filtered list one record per page by advancing `offset` by
   * `limit`, asserting every page reports the same exact total and that no
   * page carries an excluded tag. Returns the ids seen, in page order.
   */
  function walkPages(params: Array<[string, string]>, scope: string, excluded: string, expectedTotal: number) {
    const seen: string[] = [];
    const page = (offset: number): Cypress.Chainable<string[]> =>
      cy
        .request({
          method: 'GET',
          url: listQuery([...params, ['limit', '1'], ['offset', String(offset)]]),
          headers: auth(),
        })
        .then((response) => {
          expect(response.status).to.eq(200);
          expect(response.body.pagination.total, `total at offset ${offset}`).to.eq(expectedTotal);
          expect(response.body.failures).to.deep.eq([]);
          const rows = response.body.data as Record<string, any>[];
          expect(rows.length, `rows at offset ${offset}`).to.eq(offset < expectedTotal ? 1 : 0);
          for (const row of rows) {
            expect(row.tags, `row ${row.id} tags`).to.include(scope);
            expect(row.tags, `row ${row.id} tags`).to.not.include(excluded);
            seen.push(row.id);
          }
          return response.body.pagination.hasMore ? page(offset + 1) : cy.wrap(seen);
        });
    return page(0);
  }

  function libraryTotal(): Cypress.Chainable<number> {
    return cy.request({ method: 'GET', url: '/api/v1/library?limit=1', headers: auth() }).then((response) => {
      expect(response.status).to.eq(200);
      return response.body.pagination.total as number;
    });
  }

  function putTags(id: string, tags: unknown, version: number | undefined, bearer = token) {
    return cy.request({
      method: 'PUT',
      url: `/api/v1/library/${id}/tags`,
      headers: { ...auth(bearer), ...(version === undefined ? {} : { 'If-Version': String(version) }) },
      body: { tags },
      failOnStatusCode: false,
    });
  }

  before(() => {
    cy.task('getServiceAccountToken', SA2).then((result: any) => {
      foreignToken = result.accessToken;
    });
    cy.task('getServiceAccountToken', SA1).then((result: any) => {
      token = result.accessToken;
      cy.request({ method: 'GET', url: '/api/v1/dids', headers: auth() }).then((response) => {
        expect(response.status).to.eq(200);
        const defaultDid = response.body.data.find((did: Record<string, any>) => did.isDefault === true);
        expect(defaultDid).to.exist;
        issuerDid = defaultDid.did;
      });
    });
  });

  it('registers and issues tagged records, then pages past every record carrying an excluded tag', () => {
    // Four records carry this test's inclusion tag; two also carry
    // cab-portal, so each matches both `tag` and `excludeTag` and is left out.
    const scope = `${RUN_ID}-walk`;
    const ids: Record<string, string> = {};
    register('walk-portal-a', ['cab-portal', scope])
      .then((record) => {
        ids.portalA = record.id;
        return register('walk-portal-b', ['cab-portal', scope]);
      })
      .then((record) => {
        ids.portalB = record.id;
        return register('walk-scope-only', [scope]);
      })
      .then((record) => {
        ids.scopeOnly = record.id;
        return readRecord(record.id);
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.tags).to.deep.eq([scope]);
        expect(response.body.tagVersion).to.eq(1);
        return issueCredential('walk-native', [scope, 'audit']);
      })
      .then((credentialId) => {
        ids.native = credentialId;
        return readRecord(credentialId);
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.origin).to.eq('native');
        expect(response.body.tags).to.deep.eq([scope, 'audit']);
        expect(response.body.tagVersion).to.eq(1);
        expect(response.body.capabilities.taggable).to.eq(true);
        return cy.request({ method: 'GET', url: listQuery([['tag', scope]]), headers: auth() });
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.pagination.total).to.eq(4);
        return walkPages(
          [
            ['tag', scope],
            ['excludeTag', 'cab-portal'],
          ],
          scope,
          'cab-portal',
          2,
        );
      })
      .then((seen) => {
        expect(seen).to.have.members([ids.scopeOnly, ids.native]);
        expect(seen).to.not.include(ids.portalA);
        expect(seen).to.not.include(ids.portalB);
      });
  });

  it('replaces tags with PUT on both origins and refuses a stale version, a missing If-Version and another tenant', () => {
    const scope = `${RUN_ID}-put`;
    let nativeId: string;
    let externalId: string;
    issueCredential('put-native', [scope])
      .then((credentialId) => {
        nativeId = credentialId;
        return register('put-external', [scope]);
      })
      .then((record) => {
        externalId = record.id;
        return putTags(nativeId, [scope, 'audit', 'reviewed'], 1);
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(nativeId);
        expect(response.body.origin).to.eq('native');
        expect(response.body.tags).to.deep.eq([scope, 'audit', 'reviewed']);
        expect(response.body.tagVersion).to.eq(2);
        return putTags(externalId, [scope, 'cab-portal'], 1);
      })
      .then((response) => {
        expect(response.status).to.eq(200);
        expect(response.body.id).to.eq(externalId);
        expect(response.body.origin).to.eq('external');
        expect(response.body.tags).to.deep.eq([scope, 'cab-portal']);
        expect(response.body.tagVersion).to.eq(2);
        // The edit is what the next filtered read sees.
        return walkPages(
          [
            ['tag', scope],
            ['excludeTag', 'cab-portal'],
          ],
          scope,
          'cab-portal',
          1,
        );
      })
      .then((seen) => {
        expect(seen).to.deep.eq([nativeId]);
        return putTags(externalId, [scope], 1);
      })
      .then((response) => {
        expect(response.status).to.eq(409);
        expect(response.body).to.deep.eq({ error: 'The supplied If-Version is stale.', code: 'VERSION_CONFLICT' });
        return putTags(externalId, [scope], undefined);
      })
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.code).to.eq('INVALID_IF_VERSION');
        return putTags(externalId, [scope], 2, foreignToken);
      })
      .then((response) => {
        expect(response.status).to.eq(404);
        expect(response.body.code).to.eq('NOT_FOUND');
        return readRecord(externalId);
      })
      .then((response) => {
        expect(response.body.tags).to.deep.eq([scope, 'cab-portal']);
        expect(response.body.tagVersion).to.eq(2);
      });
  });

  it('refuses one invalid tag on register, single issue, batch and PUT without changing the library', () => {
    let nativeId: string;
    let totalBefore: number;
    issueCredential('invalid-put-target', [RUN_ID])
      .then((credentialId) => {
        nativeId = credentialId;
        return libraryTotal();
      })
      .then((total) => {
        totalBefore = total;
        // Refused before anything is fetched, so the source is never read.
        return cy.request({
          method: 'POST',
          url: '/api/v1/library',
          headers: { ...auth(), 'Idempotency-Key': `e2e-library-tags-invalid-register-${RUN_ID}` },
          body: registerBody(`https://example.com/never-fetched/${RUN_ID}`, 'invalid-register', ['Cab-Portal']),
          failOnStatusCode: false,
        });
      })
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body).to.deep.eq({ error: `tags.0: ${TAG_FORMAT_MESSAGE}`, code: 'VALIDATION_FAILED' });
        return issueRequestBody('invalid-issue', [RUN_ID, RUN_ID]);
      })
      .then((body) =>
        cy.request({ method: 'POST', url: '/api/v1/credentials', headers: auth(), body, failOnStatusCode: false }),
      )
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body.error).to.eq('tags.1: must not repeat a tag; duplicates tags.0');
        return issueRequestBody('invalid-batch-0').then((first) =>
          issueRequestBody('invalid-batch-1', ['a', 'b', 'c', 'b']).then((second) => ({ items: [first, second] })),
        );
      })
      .then((body) =>
        cy.request({
          method: 'POST',
          url: '/api/v1/credentials/batches',
          headers: { ...auth(), 'Idempotency-Key': `e2e-library-tags-invalid-batch-${RUN_ID}` },
          body,
          failOnStatusCode: false,
        }),
      )
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body).to.deep.eq({
          error: 'items[1].tags.3: must not repeat a tag; duplicates items[1].tags.1',
        });
        return putTags(nativeId, [RUN_ID, 'audit_2026'], 1);
      })
      .then((response) => {
        expect(response.status).to.eq(400);
        expect(response.body).to.deep.eq({ error: `tags.1: ${TAG_FORMAT_MESSAGE}`, code: 'VALIDATION_FAILED' });
        return readRecord(nativeId);
      })
      .then((response) => {
        expect(response.body.tags).to.deep.eq([RUN_ID]);
        expect(response.body.tagVersion).to.eq(1);
        return libraryTotal();
      })
      .then((totalAfter) => {
        expect(totalAfter).to.eq(totalBefore);
      });
  });

  it('refuses a list filter value outside the tag grammar, naming the parameter', () => {
    cy.request({
      method: 'GET',
      url: listQuery([['excludeTag', 'CAB-Portal']]),
      headers: auth(),
      failOnStatusCode: false,
    }).then((response) => {
      expect(response.status).to.eq(400);
      expect(response.body.error).to.eq(`excludeTag.0: ${TAG_FORMAT_MESSAGE}`);
    });
  });
});
