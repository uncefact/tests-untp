import {
  deriveLinkTypeCoverage,
  linkSetAssessment,
  linkTypeCoverageStepDetails,
  mismatchText,
  NO_RELATION_LINKS_NOTE,
} from '@/lib/linkTypeCoverage';
import { linkedCredentialRows, occurrenceKey } from '@/lib/linkSetCollection';
import type { TestStep } from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

const DPP = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
};
const DCC = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'DigitalConformityCredential'],
};
const UNKNOWN = {
  '@context': ['https://www.w3.org/ns/credentials/v2'],
  type: ['VerifiableCredential', 'SomethingElse'],
};

const terminal = (status: TestCaseStatus = TestCaseStatus.SUCCESS): TestStep[] => [
  { id: TestCaseStepId.UNTP_SCHEMA_VALIDATION, name: 'UNTP Schema Validation', status },
];
const running = (): TestStep[] => [
  { id: TestCaseStepId.UNTP_SCHEMA_VALIDATION, name: 'UNTP Schema Validation', status: TestCaseStatus.IN_PROGRESS },
];

function slot(
  instanceId: string,
  decoded: Record<string, unknown>,
  result: TestStep[] | undefined,
  extra: Record<string, unknown> = {},
) {
  return {
    instanceId,
    contentHash: instanceId,
    runId: 'run',
    payload: { original: decoded, decoded, ...extra },
    result,
  };
}

const linkSet = (context: Record<string, unknown>) => ({
  linkset: [{ anchor: 'https://id.example.org/01/1', ...context }],
});
const rows = (doc: Record<string, unknown>) => linkedCredentialRows(doc).filter((row) => row.credential);
const target = (href: string) => [{ href, title: 't', type: 'application/vc+ld+json' }];

describe('deriveLinkTypeCoverage', () => {
  it('succeeds with 3 of 3 when every relation link resolved to its type', () => {
    const doc = linkSet({ dpp: [...target('https://x/a'), ...target('https://x/b')], dcc: target('https://x/c') });
    const bindings = new Map([
      ['https://x/a', 'A'],
      ['https://x/b', 'B'],
      ['https://x/c', 'C'],
    ]);
    const items = [slot('A', DPP, terminal()), slot('B', DPP, terminal()), slot('C', DCC, terminal())];
    const coverage = deriveLinkTypeCoverage(rows(doc), bindings, items as any);
    expect(coverage).toMatchObject({ total: 3, checked: 3, mismatches: [] });
    expect(coverage.step.status).toBe(TestCaseStatus.SUCCESS);
  });

  it('fails as soon as one link resolved to another type, naming relation, type and href', () => {
    const doc = linkSet({ dcc: target('https://x/c'), dpp: target('https://x/a') });
    const bindings = new Map([['https://x/c', 'C']]);
    const coverage = deriveLinkTypeCoverage(rows(doc), bindings, [slot('C', DPP, terminal())] as any);
    expect(coverage).toMatchObject({ total: 2, checked: 1 });
    expect(coverage.step.status).toBe(TestCaseStatus.FAILURE);
    expect(coverage.mismatches).toEqual([
      expect.objectContaining({
        occurrence: { contextIndex: 0, relation: 'dcc', targetIndex: 0 },
        expectedType: 'dcc',
        detectedType: 'DigitalProductPassport',
        href: 'https://x/c',
      }),
    ]);
    expect(mismatchText(coverage.mismatches[0])).toBe('dcc link resolved to DigitalProductPassport');
  });

  it('stays pending with partial coverage and counts only settled links', () => {
    const doc = linkSet({ dpp: [...target('https://x/a'), ...target('https://x/b'), ...target('https://x/c')] });
    const bindings = new Map([
      ['https://x/a', 'A'],
      ['https://x/b', 'B'],
    ]);
    const items = [slot('A', DPP, terminal()), slot('B', DPP, running())];
    const coverage = deriveLinkTypeCoverage(rows(doc), bindings, items as any);
    expect(coverage).toMatchObject({ total: 3, checked: 1 });
    expect(coverage.step.status).toBe(TestCaseStatus.PENDING);
  });

  it('excludes a link identified as a credential only by its media type from the totals', () => {
    const doc = linkSet({
      'https://ref.gs1.org/voc/certificationInfo': target('https://x/m'),
      dpp: target('https://x/a'),
    });
    const list = rows(doc);
    expect(list).toHaveLength(2);
    const coverage = deriveLinkTypeCoverage(list, new Map([['https://x/m', 'M']]), [slot('M', DCC, terminal())] as any);
    expect(coverage).toMatchObject({ total: 1, checked: 0 });
    expect(coverage.outcomes.get(occurrenceKey(list[0].occurrence))).toEqual({ kind: 'excluded' });
  });

  it('keeps the same href under dpp and dcc in one context as two assertions with opposite outcomes', () => {
    const doc = linkSet({ dpp: target('https://x/same'), dcc: target('https://x/same') });
    const list = rows(doc);
    expect(list.map((row) => row.occurrence)).toEqual([
      { contextIndex: 0, relation: 'dpp', targetIndex: 0 },
      { contextIndex: 0, relation: 'dcc', targetIndex: 0 },
    ]);
    const coverage = deriveLinkTypeCoverage(list, new Map([['https://x/same', 'S']]), [
      slot('S', DPP, terminal()),
    ] as any);
    expect(coverage.outcomes.get(occurrenceKey(list[0].occurrence))).toMatchObject({ kind: 'match' });
    expect(coverage.outcomes.get(occurrenceKey(list[1].occurrence))).toMatchObject({ kind: 'mismatch' });
    expect(coverage.step.status).toBe(TestCaseStatus.FAILURE);
    expect(coverage.mismatches).toHaveLength(1);
  });

  it('keeps the same relation apart across contexts and across target positions', () => {
    const doc = {
      linkset: [
        { anchor: 'https://id/1', dpp: [...target('https://x/one'), ...target('https://x/two')] },
        { anchor: 'https://id/2', dpp: target('https://x/three') },
      ],
    };
    const list = rows(doc);
    const bindings = new Map([
      ['https://x/one', 'A'],
      ['https://x/two', 'B'],
      ['https://x/three', 'C'],
    ]);
    const items = [slot('A', DPP, terminal()), slot('B', DCC, terminal()), slot('C', DCC, terminal())];
    const coverage = deriveLinkTypeCoverage(list, bindings, items as any);
    // Same context, same relation, different target index: opposite outcomes must not collapse.
    expect(coverage.outcomes.get(occurrenceKey({ contextIndex: 0, relation: 'dpp', targetIndex: 0 }))).toMatchObject({
      kind: 'match',
    });
    expect(coverage.outcomes.get(occurrenceKey({ contextIndex: 0, relation: 'dpp', targetIndex: 1 }))).toMatchObject({
      kind: 'mismatch',
    });
    // Different context, same relation and target index: distinct as well.
    expect(coverage.outcomes.get(occurrenceKey({ contextIndex: 1, relation: 'dpp', targetIndex: 0 }))).toMatchObject({
      kind: 'mismatch',
    });
    expect(coverage.outcomes.size).toBe(3);
    expect(coverage.mismatches).toHaveLength(2);
  });

  it('treats a locked envelope as pending and a decrypted instance as eligible', () => {
    const doc = linkSet({ dpp: target('https://x/a') });
    const bindings = new Map([['https://x/a', 'A']]);
    const locked = deriveLinkTypeCoverage(rows(doc), bindings, [
      slot('A', DPP, terminal(), { encryptedEnvelope: true }),
    ] as any);
    expect(locked.step.status).toBe(TestCaseStatus.PENDING);
    const decrypted = deriveLinkTypeCoverage(rows(doc), bindings, [
      slot('A', DPP, terminal(), { decryptedFromEnvelope: true }),
    ] as any);
    expect(decrypted.step.status).toBe(TestCaseStatus.SUCCESS);
  });

  it('reverts to pending when the bound instance is gone', () => {
    const doc = linkSet({ dpp: target('https://x/a') });
    const coverage = deriveLinkTypeCoverage(rows(doc), new Map([['https://x/a', 'A']]), []);
    expect(coverage).toMatchObject({ total: 1, checked: 0 });
    expect(coverage.step.status).toBe(TestCaseStatus.PENDING);
  });

  it('compares a credential that failed its own validation: type match is not validity', () => {
    const doc = linkSet({ dpp: target('https://x/a') });
    const coverage = deriveLinkTypeCoverage(rows(doc), new Map([['https://x/a', 'A']]), [
      slot('A', DPP, terminal(TestCaseStatus.FAILURE)),
    ] as any);
    expect(coverage).toMatchObject({ checked: 1 });
    expect(coverage.step.status).toBe(TestCaseStatus.SUCCESS);
  });

  it('compares a recognised extension on its core type but names the extension in the outcome', () => {
    const DLP = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://aatp.foodagility.com/vocabulary/aatp/dlp/0.4.0'],
      type: ['VerifiableCredential', 'DigitalLivestockPassport'],
    };
    const matched = deriveLinkTypeCoverage(
      rows(linkSet({ dpp: target('https://x/a') })),
      new Map([['https://x/a', 'A']]),
      [slot('A', DLP, terminal())] as any,
    );
    expect(matched.step.status).toBe(TestCaseStatus.SUCCESS);
    expect(
      matched.outcomes.get(occurrenceKey(rows(linkSet({ dpp: target('https://x/a') }))[0].occurrence)),
    ).toMatchObject({ kind: 'match', detectedType: 'DigitalLivestockPassport' });
    const mismatched = deriveLinkTypeCoverage(
      rows(linkSet({ dcc: target('https://x/c') })),
      new Map([['https://x/c', 'C']]),
      [slot('C', DLP, terminal())] as any,
    );
    expect(mismatchText(mismatched.mismatches[0])).toBe('dcc link resolved to DigitalLivestockPassport');
  });

  it('never passes an unknown detected type', () => {
    const doc = linkSet({ dpp: target('https://x/a') });
    const coverage = deriveLinkTypeCoverage(rows(doc), new Map([['https://x/a', 'A']]), [
      slot('A', UNKNOWN, terminal()),
    ] as any);
    expect(coverage.step.status).toBe(TestCaseStatus.FAILURE);
    expect(coverage.mismatches[0].detectedType).toBe('Unknown');
  });

  it('succeeds with a note when the link set carries no UNTP-relation credential links', () => {
    const doc = linkSet({ pip: [{ href: 'https://x/p', title: 'page', type: 'text/html' }] });
    const coverage = deriveLinkTypeCoverage(rows(doc), new Map(), []);
    expect(coverage).toMatchObject({ total: 0, checked: 0 });
    expect(coverage.step.status).toBe(TestCaseStatus.SUCCESS);
    expect(coverage.step.details.note).toBe(NO_RELATION_LINKS_NOTE);
  });

  it('stores the same counts and mismatches on the step as on the summary, and narrows them back', () => {
    const doc = linkSet({ dcc: target('https://x/c') });
    const coverage = deriveLinkTypeCoverage(rows(doc), new Map([['https://x/c', 'C']]), [
      slot('C', DPP, terminal()),
    ] as any);
    const details = linkTypeCoverageStepDetails(coverage.step);
    expect(details).toEqual({ total: 1, checked: 1, mismatches: coverage.mismatches });
    expect(
      linkTypeCoverageStepDetails({ ...coverage.step, id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION }),
    ).toBeUndefined();
    expect(linkTypeCoverageStepDetails({ ...coverage.step, details: { total: 'x' } })).toBeUndefined();
  });
});

describe('linkSetAssessment', () => {
  const schema = (status: TestCaseStatus): TestStep[] => [
    { id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION, name: 'Schema Validation', status },
  ];
  const coverageWith = (status: TestCaseStatus) => ({
    total: 3,
    checked: status === TestCaseStatus.SUCCESS ? 3 : 1,
    mismatches: [],
    outcomes: new Map(),
    step: { id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE, name: 'Link Type Coverage', status },
  });

  it('keeps a schema-valid card successful while coverage is pending, with no schema activity', () => {
    const a = linkSetAssessment(schema(TestCaseStatus.SUCCESS), coverageWith(TestCaseStatus.PENDING));
    expect(a.overallStatus).toBe(TestCaseStatus.SUCCESS);
    expect(a.schemaRunning).toBe(false);
    expect(a.steps.map((s) => s.id)).toEqual([
      TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
    ]);
  });

  it('overrides the schema baseline with a coverage mismatch, even while the schema is still running', () => {
    const a = linkSetAssessment(schema(TestCaseStatus.IN_PROGRESS), coverageWith(TestCaseStatus.FAILURE));
    expect(a.overallStatus).toBe(TestCaseStatus.FAILURE);
    expect(a.schemaRunning).toBe(true);
  });

  it('reports a schema failure regardless of coverage, and treats an unstarted schema as running', () => {
    expect(linkSetAssessment(schema(TestCaseStatus.FAILURE), coverageWith(TestCaseStatus.SUCCESS)).overallStatus).toBe(
      TestCaseStatus.FAILURE,
    );
    const unstarted = linkSetAssessment(undefined, coverageWith(TestCaseStatus.PENDING));
    expect(unstarted.schemaRunning).toBe(true);
    expect(unstarted.overallStatus).toBe(TestCaseStatus.PENDING);
  });
});
