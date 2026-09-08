import { buildReportView } from '@/lib/reportView';
import type { PermittedCredentialType, TestReport, TestReportLinkSetResult, TestReportResult } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

const credential = (
  type: 'DigitalProductPassport' | 'DigitalConformityCredential',
  title: string,
): TestReportResult => ({
  status: TestCaseStatus.SUCCESS,
  title,
  credential: { type: ['VerifiableCredential', type] } as any,
  source: { kind: 'file', filename: title },
  core: {
    type: type as PermittedCredentialType,
    version: '0.7.0',
    steps: [{ id: TestCaseStepId.PROOF_TYPE, name: 'Proof Type Detection', status: TestCaseStatus.SUCCESS }],
  },
});

const linkSetDoc = {
  linkset: [
    {
      anchor: 'https://resolver.example.org/01/1',
      'untp:dpp': [{ href: 'https://c.example.org/dpp.json', title: 'DPP' }],
    },
  ],
};

const linkSet = (overrides: Partial<TestReportLinkSetResult> = {}): TestReportLinkSetResult => ({
  status: TestCaseStatus.SUCCESS,
  title: 'resolver.example.org/01/1',
  validationVersion: '0.7.0',
  source: { kind: 'url', url: 'https://resolver.example.org/01/1?linkType=all' },
  linkSet: linkSetDoc,
  steps: [
    {
      id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      name: 'Schema Validation',
      status: TestCaseStatus.SUCCESS,
      details: { kind: 'document', errors: [], version: '0.7.0', schemaUrl: 'https://untp.example/schema.json' },
    },
    {
      id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
      name: 'Link Type Coverage',
      status: TestCaseStatus.PENDING,
      details: { total: 3, checked: 1, mismatches: [] },
    },
  ],
  ...overrides,
});

const report = (overrides: Partial<TestReport> = {}): TestReport => ({
  date: '2026-09-08T00:00:00.000Z',
  reportName: 'UNTP',
  testSuite: { runner: 'untp-test-suite', version: '0.3.0' },
  implementation: { name: 'Acme' },
  pass: true,
  verifiableCredentials: [],
  conformitySchemes: [],
  linkSets: [],
  ...overrides,
});

describe('buildReportView (#814)', () => {
  it('groups credentials by type in the checklist order with upload order kept inside each group', () => {
    const view = buildReportView(
      report({
        verifiableCredentials: [
          credential('DigitalConformityCredential', 'dcc-1.json'),
          credential('DigitalProductPassport', 'dpp-1.json'),
          credential('DigitalConformityCredential', 'dcc-2.json'),
          credential('DigitalProductPassport', 'dpp-2.json'),
        ],
      }),
    );
    expect(view.credentialGroups.map((group) => [group.type, group.displayName, group.count])).toEqual([
      ['DigitalProductPassport', 'Digital Product Passport', 2],
      ['DigitalConformityCredential', 'Digital Conformity Credential', 2],
    ]);
    expect(view.credentialGroups[0].results.map((result) => result.title)).toEqual(['dpp-1.json', 'dpp-2.json']);
    expect(view.credentialGroups[1].results.map((result) => result.title)).toEqual(['dcc-1.json', 'dcc-2.json']);
    expect(view.verifiableCredentials).toHaveLength(4);
  });

  it('keeps a credential whose type is outside the checklist order in a trailing group rather than dropping it', () => {
    const typed = (type: string, title: string) => {
      const base = credential('DigitalProductPassport', title);
      return { ...base, core: { ...base.core, type: type as any } };
    };
    const view = buildReportView(
      report({
        verifiableCredentials: [
          typed('SomethingElse', 'x.json'),
          credential('DigitalProductPassport', 'dpp.json'),
          typed('DigitalIdentityAnchor', 'odd.json'),
        ],
      }),
    );
    expect(view.credentialGroups.map((group) => group.type)).toEqual([
      'DigitalProductPassport',
      'DigitalIdentityAnchor',
      'SomethingElse',
    ]);
    expect(view.credentialGroups.reduce((n, group) => n + group.count, 0)).toBe(3);
  });

  it('groups an extension credential under its recorded core type', () => {
    const extension = {
      ...credential('DigitalProductPassport', 'livestock.json'),
      extension: { type: 'DigitalLivestockPassport' as const, version: '0.4.0', steps: [] },
    };
    const view = buildReportView(report({ verifiableCredentials: [extension] }));
    expect(view.credentialGroups).toHaveLength(1);
    expect(view.credentialGroups[0].type).toBe('DigitalProductPassport');
    expect(view.credentialGroups[0].results[0].extension?.type).toBe('DigitalLivestockPassport');
  });

  it('builds a link-set-only view with no credential groups', () => {
    const view = buildReportView(report({ linkSets: [linkSet()] }));
    expect(view.credentialGroups).toEqual([]);
    expect(view.linkSets).toHaveLength(1);
  });

  it('adds the card copy to each link set: subtitle, coverage count, mismatch lines and schema messages', () => {
    const entry = linkSet({
      steps: [
        {
          id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
          name: 'Schema Validation',
          status: TestCaseStatus.FAILURE,
          details: {
            kind: 'document',
            version: '0.7.0',
            schemaUrl: 'https://untp.example/schema.json',
            errors: [
              {
                keyword: 'additionalProperties',
                instancePath: '/linkset/0',
                schemaPath: '#/additionalProperties',
                params: { additionalProperty: 'untp:dpp' },
                message: 'must NOT have additional properties',
              },
              {
                keyword: 'required',
                instancePath: '/linkset/0',
                schemaPath: '#/required',
                params: { missingProperty: 'anchor' },
                message: "must have required property 'anchor'",
              },
            ],
          },
        },
        {
          id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
          name: 'Link Type Coverage',
          status: TestCaseStatus.FAILURE,
          details: {
            total: 2,
            checked: 2,
            mismatches: [
              {
                occurrence: { contextIndex: 0, relation: 'untp:dcc', targetIndex: 0 },
                expectedType: 'dcc',
                detectedType: 'DigitalProductPassport',
                href: 'https://c.example.org/dcc.json',
              },
            ],
          },
        },
      ],
    });
    const [view] = buildReportView(report({ linkSets: [entry] })).linkSets;
    expect(view.subtitle).toBe('Link Set · v0.7.0');
    expect(view.coverageStep.countText).toBe('2 of 2 credential links checked.');
    expect(view.coverageStep.mismatchLines).toEqual([
      { text: 'dcc link resolved to DigitalProductPassport', href: 'https://c.example.org/dcc.json' },
    ]);
    expect(view.schemaStep.messages).toHaveLength(2);
    expect(view.schemaStep.messages[0]).toContain('rejects the relation "untp:dpp"');
    expect(view.schemaStep.messages[0]).toMatch(/concerns the relation name only\.$/);
    expect(view.schemaStep.messages[0]).not.toContain('this card');
    expect(view.schemaStep.messages[1]).toContain('anchor');
  });

  it('shows the singular count, the nothing-to-check note, and the load-failure explanation', () => {
    const single = linkSet({
      steps: [linkSet().steps[0], { ...linkSet().steps[1], details: { total: 1, checked: 0, mismatches: [] } }],
    });
    const none = linkSet({
      steps: [
        linkSet().steps[0],
        {
          ...linkSet().steps[1],
          status: TestCaseStatus.SUCCESS,
          details: { total: 0, checked: 0, mismatches: [], note: 'No UNTP-relation credential links to check.' },
        },
      ],
    });
    const unavailable = linkSet({
      steps: [
        {
          ...linkSet().steps[0],
          status: TestCaseStatus.FAILURE,
          details: {
            kind: 'schema-unavailable',
            reason: 'timeout',
            message: 'timed out',
            version: '0.7.0',
            schemaUrl: 'https://untp.example/schema.json',
          },
        },
        linkSet().steps[1],
      ],
    });
    const views = buildReportView(report({ linkSets: [single, none, unavailable] })).linkSets;
    expect(views[0].coverageStep.countText).toBe('0 of 1 credential link checked.');
    expect(views[1].coverageStep.countText).toBe('No UNTP-relation credential links to check.');
    expect(views[2].schemaStep.messages).toEqual([expect.stringContaining('could not be loaded')]);
    expect(views[2].schemaStep.messages[0]).toContain('again to retry');
  });

  it('leaves the report object untouched and keeps view-only fields out of the JSON', () => {
    const source = report({
      verifiableCredentials: [credential('DigitalProductPassport', 'a.json')],
      linkSets: [linkSet()],
    });
    const snapshot = JSON.stringify(source);
    const view = JSON.stringify(buildReportView(source));
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(view).toMatch(/credentialGroups/);
    expect(view).toMatch(/countText/);
    expect(snapshot).not.toMatch(/credentialGroups|subtitle|schemaStep|coverageStep|countText|outcomes/);
  });
});
