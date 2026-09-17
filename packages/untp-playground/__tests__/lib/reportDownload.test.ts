import { downloadHtml } from '@/lib/reportDownload';
import { classifyJsonLdFailure } from '@/lib/artefactFailure';
import type { ArtefactStepFailure } from '@/lib/artefactFailure';
import type {
  PermittedCredentialType,
  TestReport,
  TestReportLinkSetResult,
  TestReportResult,
  TestReportSchemeResult,
  TestReportStatus,
} from '@/types';
import { TestCaseStatus, TestCaseStepId } from '../../constants';

/**
 * Renders the real template (the Jest `.hbs` adapter reads it from disk) through the real
 * downloader and inspects the HTML the browser would save.
 */
describe('downloadHtml (#814)', () => {
  let mockAnchor: { href: string; download: string; click: jest.Mock };
  let html: string;

  beforeEach(() => {
    html = '';
    mockAnchor = { href: '', download: '', click: jest.fn() };
    jest.spyOn(document, 'createElement').mockReturnValue(mockAnchor as any);
    jest.spyOn(document.body, 'appendChild').mockImplementation((node) => node);
    jest.spyOn(document.body, 'removeChild').mockImplementation((node) => node);
    URL.createObjectURL = jest.fn().mockReturnValue('blob-url');
    URL.revokeObjectURL = jest.fn();
    global.Blob = jest.fn().mockImplementation((content: string[]) => {
      html = content[0];
      return { size: content[0].length, type: 'text/html' };
    }) as any;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const step = (id: TestCaseStepId, name: string, status: TestReportStatus, details?: unknown) => ({
    id,
    name,
    status,
    details,
  });

  const credential = (
    type: 'DigitalProductPassport' | 'DigitalConformityCredential',
    title: string,
    options: { decrypted?: boolean; url?: string; version?: string } = {},
  ): TestReportResult => ({
    status: TestCaseStatus.SUCCESS,
    title,
    credential: { type: ['VerifiableCredential', type] } as any,
    source: options.url ? { kind: 'url', url: options.url } : { kind: 'file', filename: title },
    core: {
      type: type as PermittedCredentialType,
      version: options.version ?? '0.7.0',
      steps: [
        ...(options.decrypted ? [step(TestCaseStepId.DECRYPTION, 'Decryption', TestCaseStatus.SUCCESS)] : []),
        step(TestCaseStepId.PROOF_TYPE, 'Proof Type Detection', TestCaseStatus.SUCCESS),
        step(TestCaseStepId.UNTP_SCHEMA_VALIDATION, 'UNTP Schema Validation', TestCaseStatus.SUCCESS),
      ],
    },
  });

  const scheme = (title: string, name: string | undefined, version = '0.7.0'): TestReportSchemeResult => ({
    status: TestCaseStatus.SUCCESS,
    title,
    type: 'ConformityScheme' as any,
    version,
    ...(name && { name }),
    source: { kind: 'file', filename: `${title.toLowerCase().replace(/\s+/g, '-')}.jsonld` },
    conformityScheme: {},
    steps: [step(TestCaseStepId.SCHEME_VERSION_DETECTION, 'Version Detection', TestCaseStatus.SUCCESS)],
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
        details: {
          kind: 'document',
          errors: [],
          version: '0.7.0',
          schemaUrl: 'https://untp.example/0.7.0/linkset.json',
        },
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
    date: '2026-09-08T10:00:00.000Z',
    reportName: 'UNTP',
    testSuite: { runner: 'untp-test-suite', version: '0.3.0', url: 'https://github.com/uncefact/tests-untp' },
    implementation: { name: 'Acme Verifier' },
    pass: true,
    verifiableCredentials: [],
    conformitySchemes: [],
    linkSets: [],
    playgroundUrl: 'https://playground.example.org',
    ...overrides,
  });

  const render = async (data: TestReport, filename = 'report') => {
    await downloadHtml(data, filename);
    return new DOMParser().parseFromString(html, 'text/html');
  };
  const headings = (doc: Document, kind: string) =>
    Array.from(doc.querySelectorAll(`article[data-result="${kind}"] .result-name`)).map((node) =>
      (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );

  it('appends .html to the filename only when missing', async () => {
    await downloadHtml(report({ verifiableCredentials: [credential('DigitalProductPassport', 'a.json')] }), 'report');
    expect(mockAnchor.download).toBe('report.html');
    await downloadHtml(
      report({ verifiableCredentials: [credential('DigitalProductPassport', 'a.json')] }),
      'report.html',
    );
    expect(mockAnchor.download).toBe('report.html');
  });

  it('groups credentials under type headings with counts, titles each block by its filename, and shows Decryption first only where recorded', async () => {
    const doc = await render(
      report({
        verifiableCredentials: [
          credential('DigitalConformityCredential', 'dcc-1.json', { decrypted: true }),
          credential('DigitalProductPassport', 'dpp-1.json', { url: 'https://c.example.org/2026/dpp-1.json' }),
          credential('DigitalConformityCredential', 'dcc-2.json'),
          credential('DigitalProductPassport', 'dpp-2.json'),
        ],
      }),
    );
    expect(doc.querySelector('[data-section-count="verifiableCredentials"]')?.textContent).toBe('4');
    const groups = Array.from(doc.querySelectorAll('.type-group')).map((node) => [
      node.querySelector('h3')?.textContent,
      node.querySelector('.tg-count')?.textContent,
    ]);
    expect(groups).toEqual([
      ['Digital Product Passport', '2'],
      ['Digital Conformity Credential', '2'],
    ]);
    expect(headings(doc, 'credential')).toEqual([
      'dpp-1.jsonv0.7.0',
      'dpp-2.jsonv0.7.0',
      'dcc-1.jsonv0.7.0',
      'dcc-2.jsonv0.7.0',
    ]);
    // The URL-sourced block is titled by its final segment, never the raw URL; the URL stays in the caption.
    expect(headings(doc, 'credential')[0]).not.toContain('https://');
    expect(doc.querySelector('article[data-result="credential"] .result-source a')?.getAttribute('href')).toBe(
      'https://c.example.org/2026/dpp-1.json',
    );
    const stepNames = (article: Element) =>
      Array.from(article.querySelectorAll('.step-name')).map((n) => n.textContent);
    const articles = Array.from(doc.querySelectorAll('article[data-result="credential"]'));
    const credentialsHeading = Array.from(doc.querySelectorAll('h2.section-h')).find(
      (heading) => heading.textContent?.includes('Verifiable Credentials'),
    );
    expect(credentialsHeading).toBeDefined();
    expect(
      credentialsHeading?.parentElement?.querySelector('article[data-result="credential"] .step-name')?.textContent,
    ).toBe('Proof Type Detection');
    expect(stepNames(articles[2])[0]).toBe('Decryption');
    expect(articles[2].querySelector('li.step')?.className).toContain('success');
    expect(stepNames(articles[0])).not.toContain('Decryption');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(doc.querySelector('.rh-meta dd')?.textContent?.trim()).toBe('8 September 2026');
    const footerLinks = Array.from(doc.querySelectorAll('.rh-footer a')).map((a) => a.getAttribute('href'));
    expect(footerLinks).toEqual(['https://playground.example.org', 'https://github.com/uncefact/tests-untp']);
    // Group headings are h3 and the blocks under them h4, so the grouping survives a headings outline.
    expect(Array.from(doc.querySelectorAll('.type-group h3')).length).toBe(2);
    expect(Array.from(doc.querySelectorAll('article[data-result="credential"] h4.result-name')).length).toBe(4);
    expect(html).not.toContain('\u2014');
  });

  it('renders the report fallback as vunknown when version detection failed', async () => {
    const doc = await render(
      report({
        verifiableCredentials: [credential('DigitalProductPassport', 'unknown.json', { version: 'unknown' })],
        conformitySchemes: [scheme('unknown-scheme.json', undefined, 'unknown')],
      }),
    );

    expect(doc.querySelector('article[data-result="credential"] .result-name')?.textContent).toContain('vunknown');
    expect(doc.querySelector('article[data-result="scheme"] .result-sub')?.textContent).toContain('vunknown');
  });

  it('renders all four scheme steps and structural messages in the HTML report', async () => {
    const entry = scheme('Structural Failure', 'Structural Failure');
    entry.status = TestCaseStatus.FAILURE;
    entry.steps = [
      step(TestCaseStepId.SCHEME_VERSION_DETECTION, 'Version Detection', TestCaseStatus.SUCCESS),
      step(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, 'Schema Validation', TestCaseStatus.SUCCESS),
      step(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, 'Structural Parse', TestCaseStatus.FAILURE, {
        errors: [
          { message: '/id: scheme.id is required and must be a non-empty string.', supportable: false },
          { message: '/name: scheme.name is required and must be a non-empty string.', supportable: false },
        ],
        diagnostics: [
          {
            code: 'conformity-scheme.missing-required-field',
            message: 'DO_NOT_RENDER_STRUCTURAL_DIAGNOSTIC',
            pointer: '/name',
          },
        ],
      }),
      step(
        TestCaseStepId.CONTEXT_VALIDATION,
        'JSON-LD Document Expansion and Context Validation',
        TestCaseStatus.SUCCESS,
      ),
    ];

    const doc = await render(report({ pass: false, conformitySchemes: [entry] }));
    const article = doc.querySelector('article[data-result="scheme"]');
    expect(Array.from(article?.querySelectorAll('.step-name') ?? []).map((node) => node.textContent)).toEqual([
      'Version Detection',
      'Schema Validation',
      'Structural Parse',
      'JSON-LD Document Expansion and Context Validation',
    ]);
    expect(doc.body.textContent).toContain('/id: scheme.id is required and must be a non-empty string.');
    expect(doc.body.textContent).toContain('/name: scheme.name is required and must be a non-empty string.');
    expect(doc.body.textContent).not.toContain('DO_NOT_RENDER_STRUCTURAL_DIAGNOSTIC');
    expect(article?.querySelector('a')).toBeNull();
  });

  const schemeFailureCases: Array<{ label: string; failure: ArtefactStepFailure }> = [
    {
      label: 'could-not-fetch',
      failure: {
        class: 'could-not-fetch',
        code: 'schema.fetch.upstream-status',
        message: 'The Playground could not fetch the scheme schema (upstream status 503).',
        remediation: 'Retry the check and report the URL to the operator if it keeps failing.',
        artefactUrl: 'https://publisher.example/scheme.json',
        upstreamStatus: 503,
      },
    },
    {
      label: 'unusable-artefact',
      failure: {
        class: 'unusable-artefact',
        code: 'schema.fetch.invalid-json',
        message: 'The scheme schema response was not valid JSON.',
        remediation: 'Report the scheme schema URL to its publisher.',
        artefactUrl: 'https://publisher.example/scheme.json',
      },
    },
    {
      label: 'credential-invalid',
      failure: {
        class: 'credential-invalid',
        code: 'conformity-scheme.parse-failed',
        message: 'The Conformity Scheme document failed structural parsing.',
        remediation: 'Correct the listed fields in the Conformity Scheme document.',
      },
    },
    {
      label: 'unknown',
      failure: {
        class: 'unknown',
        code: 'playground.pipeline.step',
        message: 'The scheme validation step failed unexpectedly.',
        remediation: 'Report these details to the Playground operator.',
      },
    },
  ];

  it.each(schemeFailureCases)('renders the $label failure summary on a scheme step', async ({ failure }) => {
    const entry = scheme('Failed Scheme', 'Failed Scheme');
    entry.status = TestCaseStatus.FAILURE;
    entry.steps = [
      step(TestCaseStepId.SCHEME_VERSION_DETECTION, 'Version Detection', TestCaseStatus.SUCCESS),
      {
        ...step(TestCaseStepId.SCHEME_STRUCTURAL_PARSE, 'Structural Parse', TestCaseStatus.FAILURE),
        failure,
      },
    ];

    const doc = await render(report({ pass: false, conformitySchemes: [entry] }));
    const summary = doc.querySelector('article[data-result="scheme"] [data-failure-summary="true"]')?.textContent ?? '';
    expect(summary).toContain(
      failure.class === 'could-not-fetch'
        ? 'Could not fetch'
        : failure.class === 'unusable-artefact'
          ? 'Unusable artefact'
          : failure.class === 'credential-invalid'
            ? 'Scheme invalid'
            : 'Could not determine the cause',
    );
    expect(summary).toContain(failure.message);
    expect(summary).toContain(failure.remediation);
  });

  it('renders every recorded failure class with its remediation and keeps field errors', async () => {
    const classes = [
      {
        class: 'could-not-fetch' as const,
        code: 'schema.fetch.upstream-status' as const,
        message: '<script>alert(1)</script>',
        remediation: 'Retry the check or report the URL and status.',
        artefactUrl: 'https://publisher.example/schema.json',
        serviceStatus: 502,
        upstreamStatus: 503,
      },
      {
        class: 'unusable-artefact' as const,
        code: 'schema.fetch.invalid-json' as const,
        message: 'The artefact was fetched but is not usable.',
        remediation: 'Report the artefact URL to its publisher.',
        artefactUrl: 'https://publisher.example/schema.json',
      },
      {
        class: 'credential-invalid' as const,
        code: 'schema.validation.payload' as const,
        message: 'The credential failed against the fetched schema.',
        remediation: 'Correct the named field in the credential.',
        artefactUrl: 'https://publisher.example/schema.json',
      },
      {
        class: 'unknown' as const,
        code: 'context.document.unknown' as const,
        message: 'Diagnostic code: invalid @language value.',
        remediation: 'Report these details to the Playground operator.',
      },
    ];
    const results = classes.map((failure, index) => {
      const result = credential('DigitalProductPassport', `failed-${index}.json`);
      result.status = TestCaseStatus.FAILURE;
      result.core.steps = [
        {
          ...result.core.steps[0],
          status: TestCaseStatus.FAILURE,
          failure,
          ...(failure.class === 'credential-invalid'
            ? { details: { errors: [{ keyword: 'required', message: 'must have issuer', params: {} }] } }
            : {}),
        },
      ];
      return result;
    });
    const doc = await render(report({ pass: false, verifiableCredentials: results }));
    const summaries = Array.from(doc.querySelectorAll('[data-failure-summary="true"]')).map((node) => node.textContent);
    expect(summaries).toHaveLength(4);
    expect(summaries[0]).toContain('Could not fetch');
    expect(summaries[0]).toContain('Retry');
    expect(summaries[1]).toContain('Unusable artefact');
    expect(summaries[1]).toContain('publisher');
    expect(summaries[2]).toContain('Credential invalid');
    expect(summaries[3]).toContain('Could not determine the cause');
    expect(summaries[0]).not.toMatch(/correct|change|rename|fix/i);
    expect(summaries[1]).not.toMatch(/correct|change|rename|fix/i);
    expect(summaries[3]).not.toMatch(/correct|change|rename|fix/i);
    expect(doc.body.textContent).toContain('must have issuer');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('renders the default remediation for a term-less invalid-property failure', async () => {
    const failure = classifyJsonLdFailure({
      kind: 'document',
      source: 'safe-mode-event',
      code: 'invalid property',
      detail: 'A property was not defined.',
    });
    const result = credential('DigitalProductPassport', 'term-less.json');
    result.status = TestCaseStatus.FAILURE;
    result.core.steps = [
      {
        ...result.core.steps[0],
        status: TestCaseStatus.FAILURE,
        failure,
      },
    ];
    const doc = await render(report({ pass: false, verifiableCredentials: [result] }));
    expect(doc.body.textContent).toContain('Correct the named field or term in the credential.');
    expect(doc.body.textContent).not.toContain('undefined');
  });

  it('names the link set a verified credential came from in its caption', async () => {
    const fromLinkSet = credential('DigitalProductPassport', 'dpp.json', { url: 'https://c.example.org/dpp.json' });
    fromLinkSet.source = {
      kind: 'url',
      url: 'https://c.example.org/dpp.json',
      via: 'link-set',
      linkSet: 'https://resolver.example.org/01/1?linkType=all',
    };
    const fileFromLinkSet = credential('DigitalProductPassport', 'enc.json');
    fileFromLinkSet.source = { kind: 'file', filename: 'enc.json', via: 'link-set', linkSet: 'links.json' };
    const doc = await render(
      report({ verifiableCredentials: [fromLinkSet, credential('DigitalProductPassport', 'b.json'), fileFromLinkSet] }),
    );
    const captions = Array.from(doc.querySelectorAll('article[data-result="credential"] .result-source')).map((n) =>
      (n.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
    expect(captions[0]).toBe(
      'source: https://c.example.org/dpp.json · from link set https://resolver.example.org/01/1?linkType=all',
    );
    expect(captions[1]).toBe('source: b.json');
    expect(captions[2]).toBe('source: enc.json · from link set links.json');
  });

  it('lists two schemes in order with count 2, titling a nameless scheme by its filename', async () => {
    const doc = await render(
      report({
        conformitySchemes: [scheme('Zinc Stewardship', 'Zinc Stewardship'), scheme('apparel-scheme.jsonld', undefined)],
      }),
    );
    expect(doc.querySelector('[data-section-count="conformitySchemes"]')?.textContent).toBe('2');
    expect(headings(doc, 'scheme')).toEqual(['Zinc Stewardship', 'apparel-scheme.jsonld']);
    expect(doc.querySelector('[data-section-count="linkSets"]')).toBeNull();
    expect(html).not.toContain('Identity Resolver Link Sets');
  });

  it('renders a link-set-only report with the other two sections omitted and both steps in order', async () => {
    const doc = await render(report({ linkSets: [linkSet()] }));
    expect(html).not.toContain('Verifiable Credentials');
    expect(html).not.toContain('Conformity Schemes');
    expect(doc.querySelector('[data-section-count="linkSets"]')?.textContent).toBe('1');
    expect(headings(doc, 'linkset')).toEqual(['resolver.example.org/01/1']);
    expect(doc.querySelector('article[data-result="linkset"] .result-sub')?.textContent).toBe('Link Set · v0.7.0');
    const steps = Array.from(doc.querySelectorAll('article[data-result="linkset"] li.step'));
    expect(steps.map((node) => node.getAttribute('data-step'))).toEqual([
      'linkset-schema-validation',
      'linkset-link-type-coverage',
    ]);
    expect(steps[1].querySelector('.step-status')?.textContent).toBe('pending');
    expect(steps[1].querySelector('[data-coverage-count]')?.textContent).toBe('1 of 3 credential links checked.');
    expect(steps[0].textContent).toContain('schema: https://untp.example/0.7.0/linkset.json');
  });

  it('shows schema errors with the shared explanation but without the card-only Verify hint, and lists mismatches with hrefs', async () => {
    const entry = linkSet({
      status: TestCaseStatus.FAILURE,
      steps: [
        {
          id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
          name: 'Schema Validation',
          status: TestCaseStatus.FAILURE,
          details: {
            kind: 'document',
            version: '0.7.0',
            schemaUrl: 'https://untp.example/0.7.0/linkset.json',
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
                instancePath: '/linkset/0/dpp/0',
                schemaPath: '#/required',
                params: { missingProperty: 'title' },
                message: "must have required property 'title'",
              },
            ],
          },
        },
        {
          id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
          name: 'Link Type Coverage',
          status: TestCaseStatus.FAILURE,
          details: {
            total: 1,
            checked: 1,
            mismatches: [
              {
                occurrence: { contextIndex: 0, relation: 'untp:dpp', targetIndex: 0 },
                expectedType: 'dpp',
                detectedType: 'DigitalConformityCredential',
                href: 'https://c.example.org/dpp.json',
              },
            ],
          },
        },
      ],
    });
    const doc = await render(report({ pass: false, linkSets: [entry] }));
    const article = doc.querySelector('article[data-result="linkset"]')!;
    expect(article.querySelector('.pill')?.textContent).toBe('failure');
    const errors = Array.from(article.querySelectorAll('li[data-step="linkset-schema-validation"] .err-msg')).map(
      (n) => n.textContent,
    );
    expect(errors).toHaveLength(2);
    expect(errors[0]).toContain('rejects the relation "untp:dpp"');
    expect(errors[1]).toContain('title');
    expect(errors[0]).toContain('concerns the relation name only.');
    expect(html).not.toContain('this card');
    expect(html).not.toContain('can still be verified');
    const mismatches = article.querySelector('li[data-step="linkset-link-type-coverage"]')!;
    expect(mismatches.querySelector('.err-msg')?.textContent).toBe('dpp link resolved to DigitalConformityCredential');
    expect(mismatches.querySelector('.err-detail li')?.textContent).toBe('https://c.example.org/dpp.json');
    expect(mismatches.querySelector('[data-coverage-count]')?.textContent).toBe('1 of 1 credential link checked.');
  });

  it('explains an unavailable and an unusable schema in the step, and escapes document text', async () => {
    const unavailable = linkSet({
      title: '<b>resolver</b>',
      steps: [
        {
          ...linkSet().steps[0],
          status: TestCaseStatus.FAILURE,
          details: {
            kind: 'schema-unavailable',
            reason: 'not-found',
            message: 'HTTP 404',
            version: '0.7.0',
            schemaUrl: 'https://untp.example/x.json',
          },
        },
        linkSet().steps[1],
      ],
    });
    const unusable = linkSet({
      steps: [
        {
          ...linkSet().steps[0],
          status: TestCaseStatus.FAILURE,
          details: {
            kind: 'schema-unusable',
            message: 'schema is invalid',
            version: '0.7.0',
            schemaUrl: 'https://untp.example/x.json',
          },
        },
        linkSet().steps[1],
      ],
    });
    const doc = await render(report({ linkSets: [unavailable, unusable] }));
    const messages = Array.from(doc.querySelectorAll('li[data-step="linkset-schema-validation"] .err-msg')).map(
      (n) => n.textContent,
    );
    expect(messages[0]).toContain('could not be loaded');
    expect(messages[0]).toContain('report it to the Playground operator');
    expect(messages[1]).toContain('could not be used');
    expect(messages[1]).toContain('schema is invalid');
    expect(html).toContain('&lt;b&gt;resolver&lt;/b&gt;');
    expect(html).not.toContain('<b>resolver</b>');
  });

  it('wraps a render failure in a download error', async () => {
    (global.Blob as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    await expect(downloadHtml(report({ linkSets: [linkSet()] }), 'x')).rejects.toThrow(
      'Failed to download HTML report',
    );
  });
});
