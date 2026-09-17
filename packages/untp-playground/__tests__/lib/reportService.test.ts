import { detectCredentialType } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { detectVersionFromContext } from '@uncefact/untp-utils/artefacts';
import type { CredentialReportInput, StoredLinkSet, TestStep } from '@/types';
import type { LinkSetAssessment } from '@/lib/linkTypeCoverage';
import { TestCaseStepId } from '../../constants';
import { reportName } from '../../config';
import { generateReport } from '@/lib/reportService';
import { TestCaseStatus } from '../../constants';
import { toSchemeStructuralParseDetails } from '@/lib/schemeStructure';
import { classifyJsonLdFailure, notExecutedFailure } from '@/lib/artefactFailure';

jest.mock('@/lib/credentialService');
jest.mock('@/lib/schemaValidation');
jest.mock('@uncefact/untp-utils/artefacts', () => ({
  ...jest.requireActual('@uncefact/untp-utils/artefacts'),
  detectVersionFromContext: jest.fn(),
}));
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  reportName: 'UNTP',
}));

describe('generateReport', () => {
  const mockImplementationName = 'Test Implementation';

  const envelopedCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: 'data:application/vc+jwt,eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvdjIiLCJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvZXhhbXBsZXMvdjIiXSwidHlwZSI6WyJWZXJpZmlhYmxlQ3JlZGVudGlhbCIsIkRpZ2l0YWxQcm9kdWN0UGFzc3BvcnQiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsibXlTdWJqZWN0UHJvcGVydHkiOiJteVN1YmplY3RWYWx1ZSJ9fQ',
  };
  const decodedCredential = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    credentialSubject: {
      mySubjectProperty: 'mySubjectValue',
    },
  };
  const mockCredentialInstance: CredentialReportInput = {
    credential: { original: envelopedCredential, decoded: decodedCredential },
    steps: [
      {
        id: 'proof-type' as any,
        name: 'Proof Type Detection',
        status: TestCaseStatus.SUCCESS,
        details: { type: 'enveloping' },
      },
      {
        id: 'vcdm-version' as any,
        name: 'VCDM Version Detection',
        status: TestCaseStatus.SUCCESS,
        details: { version: 'v2' },
      },
      {
        id: 'vcdm-schema-validation' as any,
        name: 'VCDM Schema Validation',
        status: TestCaseStatus.SUCCESS,
        details: { valid: true, errors: [] },
      },
      {
        id: 'verification' as any,
        name: 'Credential Verification',
        status: TestCaseStatus.SUCCESS,
        details: { verified: true },
      },
      {
        id: 'untp-schema-validation' as any,
        name: 'UNTP Schema Validation',
        status: TestCaseStatus.SUCCESS,
        details: { valid: true, errors: [] },
      },
    ],
  };
  const mockPassStatuses = [TestCaseStatus.SUCCESS];

  beforeEach(() => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('1.0.0');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    // credentialGroupType (used by generateReport to derive the report's core.type) falls back to
    // detectCredentialType when there is no extension; credentialService is wholesale-mocked here.
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a report with valid credential instances', async () => {
    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [mockCredentialInstance],
      passStatuses: mockPassStatuses,
    });

    expect(report).toEqual({
      date: expect.any(String),
      reportName: 'UNTP',
      testSuite: {
        runner: 'untp-test-suite',
        version: '0.3.0',
        url: 'https://github.com/uncefact/tests-untp',
      },
      implementation: {
        name: 'Test Implementation',
      },
      pass: true,
      verifiableCredentials: [
        {
          status: 'success',
          title: 'Digital Product Passport',
          credential: envelopedCredential,
          core: {
            type: 'DigitalProductPassport',
            version: '1.0.0',
            steps: mockCredentialInstance.steps,
          },
        },
      ],
      conformitySchemes: [],
      linkSets: [],
    });
  });

  it('preserves a context upstream status in the generated JSON report', async () => {
    const contextUrl = 'https://publisher.example/context.jsonld';
    const contextFailure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        code: 'resolver.http-error',
        url: contextUrl,
        upstreamStatus: 503,
        detail: 'upstream unavailable',
      },
      'context',
    );
    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [
        {
          ...mockCredentialInstance,
          steps: [
            ...mockCredentialInstance.steps,
            {
              id: TestCaseStepId.CONTEXT_VALIDATION,
              name: 'JSON-LD Document Expansion and Context Validation',
              status: TestCaseStatus.FAILURE,
              failure: contextFailure,
            },
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    const reportJson = JSON.parse(JSON.stringify(report));
    expect(reportJson.verifiableCredentials[0].core.steps).toContainEqual(
      expect.objectContaining({
        id: TestCaseStepId.CONTEXT_VALIDATION,
        failure: expect.objectContaining({
          class: 'could-not-fetch',
          code: 'context.fetch',
          artefactUrl: contextUrl,
          upstreamStatus: 503,
        }),
      }),
    );
  });

  it('projects context service and upstream statuses for both failure classes', async () => {
    const declaredUrl = 'https://vocabulary.uncefact.org/untp/0.7.0/context/';
    const credentialFailure = classifyJsonLdFailure(
      {
        kind: 'context-fetch',
        code: 'resolver.http-error',
        url: declaredUrl,
        upstreamStatus: 404,
        detail: 'upstream returned 404',
      },
      'context',
      '0.7.0',
      new Set([declaredUrl]),
      { untpContextUrls: new Set([declaredUrl]), serviceStatus: 422 },
    );
    const serviceFailure = classifyJsonLdFailure(
      { kind: 'service', detail: 'The context service answered 502.' },
      'context',
      undefined,
      undefined,
      { serviceStatus: 502 },
    );
    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [
        {
          ...mockCredentialInstance,
          steps: [
            ...mockCredentialInstance.steps,
            {
              id: TestCaseStepId.CONTEXT_VALIDATION,
              name: 'Declared context failure',
              status: TestCaseStatus.FAILURE,
              failure: credentialFailure,
            },
            {
              id: TestCaseStepId.CONTEXT_VALIDATION,
              name: 'Context service failure',
              status: TestCaseStatus.FAILURE,
              failure: serviceFailure,
            },
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    const steps = JSON.parse(JSON.stringify(report)).verifiableCredentials[0].core.steps;
    expect(steps).toContainEqual(
      expect.objectContaining({
        failure: expect.objectContaining({
          class: 'credential-invalid',
          serviceStatus: 422,
          upstreamStatus: 404,
        }),
      }),
    );
    expect(steps).toContainEqual(
      expect.objectContaining({
        failure: expect.objectContaining({ class: 'could-not-fetch', serviceStatus: 502 }),
      }),
    );
  });

  it('projects the service status for every context outcome that received a response', async () => {
    const remoteContextUrl = 'https://publisher.example/remote-context.jsonld';
    const failures: Array<NonNullable<TestStep['failure']>> = [
      classifyJsonLdFailure(
        {
          kind: 'context-invalid',
          code: 'resolver.invalid-json',
          url: remoteContextUrl,
          detail: 'the remote context was not usable',
        },
        'context',
        undefined,
        undefined,
        { serviceStatus: 422 },
      ),
      classifyJsonLdFailure(
        {
          kind: 'context-invalid',
          code: 'invalid scoped context',
          url: remoteContextUrl,
          detail: 'the invalid context origin was not established',
        },
        'context',
        undefined,
        undefined,
        { serviceStatus: 422 },
      ),
      classifyJsonLdFailure(
        {
          kind: 'document',
          source: 'safe-mode-event',
          code: 'invalid property',
          detail: 'bad property',
          fields: { property: 'unknownTerm' },
        },
        'context',
        undefined,
        undefined,
        { serviceStatus: 422 },
      ),
      classifyJsonLdFailure(
        {
          kind: 'document',
          source: 'safe-mode-event',
          code: 'invalid @language value',
          detail: 'bad language',
          fields: { language: 'en_US!' },
        },
        'context',
        undefined,
        undefined,
        { serviceStatus: 422 },
      ),
      classifyJsonLdFailure(
        {
          kind: 'service',
          detail: 'The Playground context service answered 200 but the result did not finish arriving within 15s.',
        },
        'context',
        undefined,
        undefined,
        { serviceStatus: 200 },
      ),
    ];
    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [
        {
          ...mockCredentialInstance,
          steps: [
            ...mockCredentialInstance.steps,
            ...failures.map((failure, index) => ({
              id: TestCaseStepId.CONTEXT_VALIDATION,
              name: `Context outcome ${index + 1}`,
              status: TestCaseStatus.FAILURE,
              failure,
            })),
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    const projectedFailures = JSON.parse(JSON.stringify(report)).verifiableCredentials[0].core.steps;
    expect(projectedFailures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          failure: expect.objectContaining({
            class: 'unusable-artefact',
            code: 'context.invalid',
            serviceStatus: 422,
          }),
        }),
        expect.objectContaining({
          failure: expect.objectContaining({ class: 'unknown', code: 'context.invalid', serviceStatus: 422 }),
        }),
        expect.objectContaining({
          failure: expect.objectContaining({
            class: 'credential-invalid',
            code: 'context.document.invalid-property',
            serviceStatus: 422,
          }),
        }),
        expect.objectContaining({
          failure: expect.objectContaining({ class: 'unknown', code: 'context.document.unknown', serviceStatus: 422 }),
        }),
        expect.objectContaining({
          failure: expect.objectContaining({
            class: 'could-not-fetch',
            code: 'context.service',
            serviceStatus: 200,
            message: expect.stringContaining('did not finish arriving within 15s'),
          }),
        }),
      ]),
    );
  });

  it('should throw an error if no valid credential or scheme instances are provided', async () => {
    await expect(
      generateReport({
        implementationName: mockImplementationName,
        credentialInstances: [],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('No credentials, conformity schemes or link sets to generate report.');
  });

  it('writes unknown for a credential when no UNTP version is detected', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue(undefined);

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [mockCredentialInstance],
      passStatuses: mockPassStatuses,
    });

    expect(report.verifiableCredentials[0].core.version).toBe('unknown');
  });

  it('writes unknown for a conformity scheme when no UNTP version is detected', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue(undefined);

    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: { type: ['ConformityScheme'] } },
          steps: [
            {
              id: TestCaseStepId.SCHEME_VERSION_DETECTION,
              name: 'Version Detection',
              status: TestCaseStatus.SUCCESS,
            },
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    expect(report.conformitySchemes[0].version).toBe('unknown');
  });

  it('should generate a report with the extension', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { type: 'DigitalProductPassport', version: '1.0.0' },
      extension: { type: 'extensionType', version: '1.0.0' },
    });

    const mockConfig = require('../../config');
    mockConfig.reportName = 'AATP';

    const instance: CredentialReportInput = {
      credential: { original: envelopedCredential, decoded: decodedCredential },
      steps: [
        {
          id: 'extension-schema-validation' as any,
          name: 'Extension Schema Validation',
          status: TestCaseStatus.SUCCESS,
          details: { valid: true, errors: [] },
        },
        {
          id: 'context' as any,
          name: 'JSON-LD Document Expansion and Context Validation',
          status: TestCaseStatus.FAILURE,
          details: {
            errors: [
              {
                keyword: 'const',
                message: 'Properties are defined in the credential but missing from the context.',
                instancePath: 'credentialSubject',
              },
            ],
          },
        },
      ],
    };

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [instance],
      passStatuses: mockPassStatuses,
    });

    expect(report.reportName).toBe('AATP');
    expect(report.verifiableCredentials[0].core.type).toBe('DigitalProductPassport');
    // The context step failed, so the credential's overall status (and report-level pass flag via
    // it) must be failure, matching the equivalent assertion on the scheme path below.
    expect(report.verifiableCredentials[0].status).toBe(TestCaseStatus.FAILURE);
    expect(report.verifiableCredentials[0].status).toBe(TestCaseStatus.FAILURE);
    expect(report.verifiableCredentials[0].extension).toEqual({
      type: 'extensionType',
      version: '1.0.0',
      steps: [
        {
          id: 'extension-schema-validation',
          name: 'Extension Schema Validation',
          status: 'success',
          details: {
            valid: true,
            errors: [],
          },
        },
      ],
    });
  });

  it('includes scheme results, top-level metadata, and source when a scheme is provided', async () => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.7.0');
    const schemeInstances = [
      {
        scheme: {
          original: {},
          decoded: {
            '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
            type: ['ConformityScheme'],
            id: 'https://example.com/scheme/1',
            name: 'Sample Scheme',
          },
          source: { kind: 'url' as const, url: 'https://example.com/scheme/1.json' },
        },
        steps: [
          { id: 'scheme-version-detection' as any, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
          { id: 'scheme-schema-validation' as any, name: 'Schema Validation', status: TestCaseStatus.SUCCESS },
          { id: 'context' as any, name: 'Context Validation', status: TestCaseStatus.SUCCESS },
        ],
      },
    ];

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [],
      schemeInstances,
      passStatuses: mockPassStatuses,
    });

    expect(report.pass).toBe(true);
    expect(report.verifiableCredentials).toEqual([]);
    expect(report.linkSets).toEqual([]);
    expect(report.conformitySchemes).toHaveLength(1);
    expect(report.conformitySchemes[0]).toMatchObject({
      status: TestCaseStatus.SUCCESS,
      title: 'Sample Scheme',
      type: 'ConformityScheme',
      version: '0.7.0',
      name: 'Sample Scheme',
      id: 'https://example.com/scheme/1',
      source: { kind: 'url', url: 'https://example.com/scheme/1.json' },
    });
  });

  it('marks the report as failed when any scheme step fails', async () => {
    const schemeInstances = [
      {
        scheme: {
          original: {},
          decoded: {
            '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
            type: ['ConformityScheme'],
          },
        },
        steps: [
          { id: 'scheme-version-detection' as any, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
          { id: 'scheme-schema-validation' as any, name: 'Schema Validation', status: TestCaseStatus.FAILURE },
          { id: 'context' as any, name: 'Context Validation', status: TestCaseStatus.SUCCESS },
        ],
      },
    ];

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [],
      schemeInstances,
      passStatuses: mockPassStatuses,
    });

    expect(report.pass).toBe(false);
    expect(report.conformitySchemes[0].status).toBe(TestCaseStatus.FAILURE);
  });

  it('carries structural diagnostics and fails the report on a parse-only failure', async () => {
    const diagnostics = [
      {
        code: 'conformity-scheme.missing-required-field',
        message: 'scheme.name is required and must be a non-empty string.',
        pointer: '/name',
        expected: 'non-empty string',
      },
    ];
    const structuralDetails = toSchemeStructuralParseDetails({
      kind: 'document-failure',
      errors: [{ message: '/name: scheme.name is required and must be a non-empty string.', supportable: false }],
      diagnostics,
    });
    const steps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.SUCCESS },
      {
        id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
        name: 'Structural Parse',
        status: TestCaseStatus.FAILURE,
        details: structuralDetails,
        failure: {
          class: 'credential-invalid',
          code: 'conformity-scheme.parse-failed',
          message: 'The Conformity Scheme document failed structural parsing.',
          remediation: 'Correct the listed fields in the Conformity Scheme document.',
        },
      },
      {
        id: TestCaseStepId.CONTEXT_VALIDATION,
        name: 'JSON-LD Document Expansion and Context Validation',
        status: TestCaseStatus.SUCCESS,
      },
    ];
    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: { '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'] } },
          steps,
        },
      ],
      passStatuses: mockPassStatuses,
    });

    expect(report.pass).toBe(false);
    expect(report.conformitySchemes[0].steps).toEqual(steps);
    expect(report.conformitySchemes[0].steps[2].details).toEqual({
      errors: [{ message: '/name: scheme.name is required and must be a non-empty string.', supportable: false }],
      diagnostics,
    });
  });

  const schemeFailureCases: Array<{
    label: string;
    failure: NonNullable<TestStep['failure']>;
  }> = [
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

  it.each(schemeFailureCases)('carries the $label failure on a scheme step in JSON', async ({ failure }) => {
    const steps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION, name: 'Schema Validation', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE, name: 'Structural Parse', status: TestCaseStatus.FAILURE, failure },
      {
        id: TestCaseStepId.CONTEXT_VALIDATION,
        name: 'JSON-LD Document Expansion and Context Validation',
        status: TestCaseStatus.SUCCESS,
      },
    ];
    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: { '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'] } },
          steps,
        },
      ],
      passStatuses: mockPassStatuses,
    });

    expect(JSON.parse(JSON.stringify(report)).conformitySchemes[0].steps[2].failure).toEqual(failure);
  });

  it('does not add failure metadata to a successful scheme step', async () => {
    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: { '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'] } },
          steps: [
            { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    const reportJson = JSON.parse(JSON.stringify(report));
    expect(reportJson.conformitySchemes[0].steps[0]).not.toHaveProperty('failure');
  });

  it('carries the schema-selection skip marker and blocker into the JSON report', async () => {
    const skipDetails = {
      errors: [{ message: 'Skipped: schema selection failed.' }],
      diagnostics: [],
      skipped: true,
      blockedBy: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
    };
    const steps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
      {
        id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
        name: 'Schema Validation',
        status: TestCaseStatus.FAILURE,
        details: { errors: [{ message: 'schema selection failed' }] },
      },
      {
        id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
        name: 'Structural Parse',
        status: TestCaseStatus.FAILURE,
        details: skipDetails,
        failure: notExecutedFailure(TestCaseStepId.SCHEME_SCHEMA_VALIDATION, 'scheme'),
      },
      {
        id: TestCaseStepId.CONTEXT_VALIDATION,
        name: 'JSON-LD Document Expansion and Context Validation',
        status: TestCaseStatus.SUCCESS,
      },
    ];
    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: { '@context': ['https://vocabulary.uncefact.org/untp/0.6.0/'] } },
          steps,
        },
      ],
      passStatuses: mockPassStatuses,
    });

    expect(report.conformitySchemes[0].steps[2].details).toEqual(skipDetails);
    expect(report.conformitySchemes[0].steps[2].failure).toEqual(
      expect.objectContaining({
        class: 'unknown',
        code: 'playground.pipeline.not-executed',
        blockedBy: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
      }),
    );
  });

  it('carries the version-detection blocker on the Structural Parse skip into the JSON report', async () => {
    const skipDetails = {
      errors: [{ message: 'Skipped: version detection failed.' }],
      diagnostics: [],
      skipped: true,
      blockedBy: TestCaseStepId.SCHEME_VERSION_DETECTION,
    };
    const report = await generateReport({
      implementationName: mockImplementationName,
      schemeInstances: [
        {
          scheme: { original: {}, decoded: {} },
          steps: [
            {
              id: TestCaseStepId.SCHEME_VERSION_DETECTION,
              name: 'Version Detection',
              status: TestCaseStatus.FAILURE,
              details: { errors: [{ message: 'Could not detect a UNTP version.' }] },
            },
            {
              id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
              name: 'Schema Validation',
              status: TestCaseStatus.FAILURE,
              details: { errors: [{ message: 'Skipped: version detection failed.' }] },
            },
            {
              id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE,
              name: 'Structural Parse',
              status: TestCaseStatus.FAILURE,
              details: skipDetails,
            },
            {
              id: TestCaseStepId.CONTEXT_VALIDATION,
              name: 'JSON-LD Document Expansion and Context Validation',
              status: TestCaseStatus.FAILURE,
              details: { errors: [{ message: 'Skipped: version detection failed.' }] },
            },
          ],
        },
      ],
      passStatuses: mockPassStatuses,
    });

    expect(report.conformitySchemes[0].steps[2].details).toEqual(skipDetails);
  });

  it('refuses to generate a report while a scheme instance is still validating', async () => {
    await expect(
      generateReport({
        implementationName: mockImplementationName,
        credentialInstances: [],
        schemeInstances: [
          {
            scheme: {
              original: {},
              decoded: {
                '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
                type: ['ConformityScheme'],
              },
            },
            steps: [
              {
                id: TestCaseStepId.SCHEME_VERSION_DETECTION,
                name: 'Version Detection',
                status: TestCaseStatus.SUCCESS,
              },
              {
                id: TestCaseStepId.SCHEME_SCHEMA_VALIDATION,
                name: 'Schema Validation',
                status: TestCaseStatus.SUCCESS,
              },
              { id: TestCaseStepId.SCHEME_STRUCTURAL_PARSE, name: 'Structural Parse', status: TestCaseStatus.PENDING },
              {
                id: TestCaseStepId.CONTEXT_VALIDATION,
                name: 'JSON-LD Document Expansion and Context Validation',
                status: TestCaseStatus.SUCCESS,
              },
            ],
          },
        ],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('Cannot generate a report while a scheme is still validating.');
  });

  it('refuses to generate a report while a credential instance is still validating', async () => {
    await expect(
      generateReport({
        implementationName: mockImplementationName,
        credentialInstances: [
          {
            credential: {
              original: {},
              decoded: { '@context': ['https://www.w3.org/ns/credentials/v2'], type: ['VerifiableCredential'] },
            },
            steps: [], // credential loaded but no results yet
          },
        ],
        schemeInstances: [],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('Cannot generate a report while a credential is still validating.');
  });

  it('keeps two terminal instances of the same core type as two separate report entries', async () => {
    const instanceA: CredentialReportInput = {
      credential: { original: { ...envelopedCredential, id: 'a' }, decoded: { ...decodedCredential, id: 'a' } },
      steps: mockCredentialInstance.steps,
    };
    const instanceB: CredentialReportInput = {
      credential: { original: { ...envelopedCredential, id: 'b' }, decoded: { ...decodedCredential, id: 'b' } },
      steps: mockCredentialInstance.steps,
    };

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentialInstances: [instanceA, instanceB],
      passStatuses: mockPassStatuses,
    });

    // Multi-instance cardinality: two loaded instances of the same core type must produce two
    // report entries. A regression to a type-keyed structure would collapse them to one.
    expect(report.verifiableCredentials).toHaveLength(2);
    expect(report.verifiableCredentials[0].core.type).toBe('DigitalProductPassport');
    expect(report.verifiableCredentials[1].core.type).toBe('DigitalProductPassport');
    expect(report.verifiableCredentials[0].credential).toEqual({ ...envelopedCredential, id: 'a' });
    expect(report.verifiableCredentials[1].credential).toEqual({ ...envelopedCredential, id: 'b' });
  });
});

describe('generateReport link sets and titles (#814)', () => {
  const mockPassStatuses = [TestCaseStatus.SUCCESS];
  const decodedDpp = {
    '@context': ['https://www.w3.org/ns/credentials/v2'],
    type: ['VerifiableCredential', 'DigitalProductPassport'],
    credentialSubject: {},
  };
  const mockCredentialInstance: CredentialReportInput = {
    credential: { original: decodedDpp, decoded: decodedDpp },
    steps: [
      { id: TestCaseStepId.PROOF_TYPE, name: 'Proof Type Detection', status: TestCaseStatus.SUCCESS },
      { id: TestCaseStepId.UNTP_SCHEMA_VALIDATION, name: 'UNTP Schema Validation', status: TestCaseStatus.SUCCESS },
    ],
  };

  beforeEach(() => {
    (detectVersionFromContext as jest.Mock).mockReturnValue('0.7.0');
    (detectExtension as jest.Mock).mockReturnValue(undefined);
    (detectCredentialType as jest.Mock).mockReturnValue('DigitalProductPassport');
  });

  // AC3 in the report contract: the real detector runs here, so a return to the truncating regex
  // writes '0.7.0-rc' into the report JSON and fails this.
  it('writes the whole multi-segment prerelease into the report', async () => {
    const { detectVersionFromContext: realDetectVersionFromContext } = jest.requireActual<
      typeof import('@uncefact/untp-utils/artefacts')
    >('@uncefact/untp-utils/artefacts');
    (detectVersionFromContext as jest.Mock).mockImplementation(realDetectVersionFromContext);
    const prereleaseDpp = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/0.7.0-rc.1/context/'],
      type: ['VerifiableCredential', 'DigitalProductPassport'],
      credentialSubject: {},
    };

    const report = await generateReport({
      implementationName: 'Prerelease',
      credentialInstances: [
        {
          credential: { original: prereleaseDpp, decoded: prereleaseDpp },
          steps: [
            { id: TestCaseStepId.PROOF_TYPE, name: 'Proof Type Detection', status: TestCaseStatus.SUCCESS },
            {
              id: TestCaseStepId.UNTP_SCHEMA_VALIDATION,
              name: 'UNTP Schema Validation',
              status: TestCaseStatus.SUCCESS,
            },
          ],
        },
      ],
      passStatuses: [TestCaseStatus.SUCCESS],
    });

    expect(report.verifiableCredentials[0].core.version).toBe('0.7.0-rc.1');
  });

  const linkSetDoc = {
    linkset: [
      {
        anchor: 'https://resolver.example.org/01/09520123456788',
        'https://test.uncefact.org/voc/untp/dpp': [
          { href: 'https://credentials.example.org/dpp-1.json', title: 'DPP' },
          { href: 'https://credentials.example.org/dpp-2.json', title: 'DPP' },
        ],
        'https://test.uncefact.org/voc/untp/dcc': [{ href: 'https://credentials.example.org/dcc.json', title: 'DCC' }],
      },
    ],
  };
  const schemaDetails = {
    kind: 'document' as const,
    errors: [],
    version: '0.7.0',
    schemaUrl: 'https://untp.example/0.7.0/linkset.json',
  };
  const schemaStep = (
    status: TestCaseStatus,
    details: unknown = schemaDetails,
    failure?: TestStep['failure'],
  ): TestStep => ({
    id: TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
    name: 'Schema Validation',
    status,
    ...(details !== null && { details }),
    ...(failure && { failure }),
  });
  const coverageStep = (status: TestCaseStatus, details: Record<string, unknown>): TestStep => ({
    id: TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
    name: 'Link Type Coverage',
    status,
    details,
  });
  const mismatch = {
    occurrence: { contextIndex: 0, relation: 'https://test.uncefact.org/voc/untp/dcc', targetIndex: 0 },
    expectedType: 'dcc' as const,
    detectedType: 'DigitalProductPassport',
    href: 'https://credentials.example.org/dcc.json',
  };
  const assessmentOf = (
    steps: TestStep[],
    overallStatus: TestCaseStatus,
    schemaRunning = false,
  ): LinkSetAssessment => ({
    steps,
    overallStatus,
    schemaRunning,
    coverage: { total: 0, checked: 0, mismatches: [], outcomes: new Map(), step: steps[1] },
  });
  const stored = (validationVersion = '0.7.0'): StoredLinkSet => ({
    original: linkSetDoc,
    decoded: linkSetDoc,
    source: { kind: 'url', url: 'https://resolver.example.org/01/09520123456788?linkType=all' },
    validationVersion,
  });
  // A stray key on the stored details proves the projection copies named fields, not the object.
  const pending = coverageStep(TestCaseStatus.PENDING, { total: 3, checked: 1, mismatches: [], outcomes: new Map() });

  it('records a link set with its stored version, title, source, document and both steps in order, and passes with pending coverage', async () => {
    const report = await generateReport({
      implementationName: 'Acme',
      linkSetInstances: [
        {
          linkSet: stored(),
          assessment: assessmentOf([schemaStep(TestCaseStatus.SUCCESS), pending], TestCaseStatus.SUCCESS),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.verifiableCredentials).toEqual([]);
    expect(report.conformitySchemes).toEqual([]);
    expect(report.pass).toBe(true);
    expect(report.linkSets).toHaveLength(1);
    const entry = report.linkSets[0];
    expect(entry).toMatchObject({
      status: TestCaseStatus.SUCCESS,
      title: 'resolver.example.org/01/09520123456788',
      validationVersion: '0.7.0',
      source: { kind: 'url', url: 'https://resolver.example.org/01/09520123456788?linkType=all' },
      linkSet: linkSetDoc,
    });
    expect(entry.steps.map((step) => step.id)).toEqual([
      TestCaseStepId.LINKSET_SCHEMA_VALIDATION,
      TestCaseStepId.LINKSET_LINK_TYPE_COVERAGE,
    ]);
    expect(entry.steps[0].details).toEqual(schemaDetails);
    expect(entry.steps[1].status).toBe(TestCaseStatus.PENDING);
    expect(Object.keys(entry).sort()).toEqual(['linkSet', 'source', 'status', 'steps', 'title', 'validationVersion']);
    // The coverage details are copied field by field: the derived outcomes Map never reaches JSON.
    expect(JSON.parse(JSON.stringify(entry)).steps[1].details).toEqual({ total: 3, checked: 1, mismatches: [] });
  });

  it('keeps the stored validation version rather than any default, and keeps the note when there was nothing to check', async () => {
    const note = coverageStep(TestCaseStatus.SUCCESS, {
      total: 0,
      checked: 0,
      mismatches: [],
      note: 'No UNTP-relation credential links to check.',
    });
    const report = await generateReport({
      implementationName: 'Acme',
      linkSetInstances: [
        {
          linkSet: stored('0.8.0-synthetic'),
          assessment: assessmentOf([schemaStep(TestCaseStatus.SUCCESS), note], TestCaseStatus.SUCCESS),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.linkSets[0].validationVersion).toBe('0.8.0-synthetic');
    expect(JSON.parse(JSON.stringify(report.linkSets[0])).steps[1].details).toEqual({
      total: 0,
      checked: 0,
      mismatches: [],
      note: 'No UNTP-relation credential links to check.',
    });
  });

  it('fails the link set and the report on a coverage mismatch, keeping each mismatch with its occurrence', async () => {
    const twice = { ...mismatch, occurrence: { ...mismatch.occurrence, targetIndex: 1 } };
    const failing = coverageStep(TestCaseStatus.FAILURE, { total: 3, checked: 3, mismatches: [mismatch, twice] });
    const report = await generateReport({
      implementationName: 'Acme',
      linkSetInstances: [
        {
          linkSet: stored(),
          assessment: assessmentOf([schemaStep(TestCaseStatus.SUCCESS), failing], TestCaseStatus.FAILURE),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.pass).toBe(false);
    expect(report.linkSets[0].status).toBe(TestCaseStatus.FAILURE);
    expect(report.linkSets[0].steps[1].details.mismatches).toEqual([mismatch, twice]);
  });

  it('records a schema failure with its errors, and the unavailable and unusable categories with their reasons', async () => {
    const documentFailure = {
      kind: 'document' as const,
      errors: [
        {
          keyword: 'required',
          instancePath: '/linkset/0',
          schemaPath: '#/required',
          params: { missingProperty: 'anchor' },
          message: "must have required property 'anchor'",
        },
      ],
      version: '0.7.0',
      schemaUrl: schemaDetails.schemaUrl,
    };
    const unavailable = {
      kind: 'schema-unavailable' as const,
      reason: 'not-found' as const,
      message: 'HTTP 404',
      version: '0.7.0',
      schemaUrl: schemaDetails.schemaUrl,
    };
    const unusable = {
      kind: 'schema-unusable' as const,
      message: 'schema is invalid',
      version: '0.7.0',
      schemaUrl: schemaDetails.schemaUrl,
    };
    const report = await generateReport({
      implementationName: 'Acme',
      linkSetInstances: [documentFailure, unavailable, unusable].map((details) => ({
        linkSet: stored(),
        assessment: assessmentOf([schemaStep(TestCaseStatus.FAILURE, details), pending], TestCaseStatus.FAILURE),
      })),
      passStatuses: mockPassStatuses,
    });
    expect(report.pass).toBe(false);
    expect(report.linkSets.map((entry) => entry.status)).toEqual([
      TestCaseStatus.FAILURE,
      TestCaseStatus.FAILURE,
      TestCaseStatus.FAILURE,
    ]);
    expect(report.linkSets.map((entry) => entry.steps[0].details)).toEqual([documentFailure, unavailable, unusable]);
    expect(report.linkSets.map((entry) => entry.validationVersion)).toEqual(['0.7.0', '0.7.0', '0.7.0']);
  });

  it('copies the recorded link-set failure to the report step without reclassifying it', async () => {
    const failure: NonNullable<TestStep['failure']> = {
      class: 'unusable-artefact',
      code: 'schema.fetch.invalid-json',
      message: 'The schema body was fetched but was not valid JSON.',
      remediation: 'Report the schema URL to its publisher.',
      artefactUrl: schemaDetails.schemaUrl,
    };
    const report = await generateReport({
      implementationName: 'Acme',
      linkSetInstances: [
        {
          linkSet: stored(),
          assessment: assessmentOf(
            [schemaStep(TestCaseStatus.FAILURE, schemaDetails, failure), pending],
            TestCaseStatus.FAILURE,
          ),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.linkSets[0].steps[0].failure).toEqual(failure);
  });

  it('refuses while a link set schema step is still running, when the assessment is missing, and on a malformed assessment', async () => {
    const running = assessmentOf([schemaStep(TestCaseStatus.IN_PROGRESS), pending], TestCaseStatus.IN_PROGRESS, true);
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: running }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('Cannot generate a report while a link set is still validating.');
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: undefined }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('Cannot generate a report while a link set is still validating.');
    const oneStep = assessmentOf([schemaStep(TestCaseStatus.SUCCESS)], TestCaseStatus.SUCCESS);
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: oneStep }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('expected two steps');
    const swapped = assessmentOf([pending, schemaStep(TestCaseStatus.SUCCESS)], TestCaseStatus.SUCCESS);
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: swapped }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('not Schema Validation');
    const twoSchema = assessmentOf(
      [schemaStep(TestCaseStatus.SUCCESS), schemaStep(TestCaseStatus.SUCCESS)],
      TestCaseStatus.SUCCESS,
    );
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: twoSchema }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('not Link Type Coverage');
    const runningCoverageStep = coverageStep(TestCaseStatus.IN_PROGRESS, { total: 1, checked: 0, mismatches: [] });
    const runningCoverage = assessmentOf(
      [schemaStep(TestCaseStatus.SUCCESS), runningCoverageStep],
      TestCaseStatus.SUCCESS,
    );
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: runningCoverage }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('not readable');
    const noDetails = assessmentOf([schemaStep(TestCaseStatus.SUCCESS, null), pending], TestCaseStatus.SUCCESS);
    const kindOnly = assessmentOf(
      [schemaStep(TestCaseStatus.SUCCESS, { kind: 'document' }), pending],
      TestCaseStatus.SUCCESS,
    );
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: kindOnly }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('carries no attempt details');
    await expect(
      generateReport({
        implementationName: 'Acme',
        linkSetInstances: [{ linkSet: stored(), assessment: noDetails }],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('carries no attempt details');
  });

  it('titles credentials by filename or URL segment and keeps the leading Decryption step exactly as recorded', async () => {
    const decryptedSteps: TestStep[] = [
      { id: TestCaseStepId.DECRYPTION, name: 'Decryption', status: TestCaseStatus.SUCCESS },
      ...mockCredentialInstance.steps,
    ];
    const report = await generateReport({
      implementationName: 'Acme',
      credentialInstances: [
        {
          credential: { ...mockCredentialInstance.credential, source: { kind: 'file', filename: 'dpp-a.json' } },
          steps: mockCredentialInstance.steps,
        },
        {
          credential: {
            ...mockCredentialInstance.credential,
            source: { kind: 'url', url: 'https://c.example.org/x/dpp-b.json?x=1' },
            decryptedFromEnvelope: true,
          },
          steps: decryptedSteps,
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.verifiableCredentials.map((entry) => entry.title)).toEqual(['dpp-a.json', 'dpp-b.json']);
    expect(report.verifiableCredentials[0].core.steps[0].id).toBe(TestCaseStepId.PROOF_TYPE);
    expect(report.verifiableCredentials[1].core.steps.map((step) => step.id)).toEqual(
      decryptedSteps.map((step) => step.id),
    );
    expect(
      report.verifiableCredentials[1].core.steps.filter((step) => step.id === TestCaseStepId.DECRYPTION),
    ).toHaveLength(1);
    expect(report.verifiableCredentials[0].core.steps.map((step) => step.id)).toEqual(
      mockCredentialInstance.steps.map((step) => step.id),
    );
    expect(report.verifiableCredentials[1].core.steps[0]).toEqual({
      id: TestCaseStepId.DECRYPTION,
      name: 'Decryption',
      status: TestCaseStatus.SUCCESS,
    });
  });

  it('keeps two schemes in upload order, titling a nameless scheme by its filename without inventing a name', async () => {
    const steps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
    ];
    const report = await generateReport({
      implementationName: 'Acme',
      schemeInstances: [
        {
          scheme: {
            original: {},
            decoded: {
              '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
              type: ['ConformityScheme'],
              name: 'Zinc Stewardship',
            },
            source: { kind: 'file', filename: 'zinc.jsonld' },
          },
          steps,
        },
        {
          scheme: {
            original: {},
            decoded: {
              '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
              type: ['ConformityScheme'],
            },
            source: { kind: 'file', filename: 'apparel-scheme.jsonld' },
          },
          steps,
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(report.conformitySchemes).toHaveLength(2);
    expect(report.conformitySchemes.map((entry) => entry.title)).toEqual(['Zinc Stewardship', 'apparel-scheme.jsonld']);
    expect(report.conformitySchemes[0].name).toBe('Zinc Stewardship');
    expect(report.conformitySchemes[1]).not.toHaveProperty('name');
    expect(Object.keys(report.conformitySchemes[0]).sort()).toEqual([
      'conformityScheme',
      'name',
      'source',
      'status',
      'steps',
      'title',
      'type',
      'version',
    ]);
  });

  it('carries all three families in one report and fails it on the one failing entry, whichever family it is', async () => {
    const schemeSteps: TestStep[] = [
      { id: TestCaseStepId.SCHEME_VERSION_DETECTION, name: 'Version Detection', status: TestCaseStatus.SUCCESS },
    ];
    const schemeDoc = {
      '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
      type: ['ConformityScheme'],
      name: 'S',
    };
    const failing = coverageStep(TestCaseStatus.FAILURE, { total: 1, checked: 1, mismatches: [mismatch] });
    const withFailingLinkSet = await generateReport({
      implementationName: 'Acme',
      credentialInstances: [mockCredentialInstance],
      schemeInstances: [{ scheme: { original: {}, decoded: schemeDoc }, steps: schemeSteps }],
      linkSetInstances: [
        {
          linkSet: stored(),
          assessment: assessmentOf([schemaStep(TestCaseStatus.SUCCESS), failing], TestCaseStatus.FAILURE),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(
      [withFailingLinkSet.verifiableCredentials, withFailingLinkSet.conformitySchemes, withFailingLinkSet.linkSets].map(
        (a) => a.length,
      ),
    ).toEqual([1, 1, 1]);
    expect(withFailingLinkSet.pass).toBe(false);
    const withFailingScheme = await generateReport({
      implementationName: 'Acme',
      credentialInstances: [mockCredentialInstance],
      schemeInstances: [
        {
          scheme: { original: {}, decoded: schemeDoc },
          steps: [{ ...schemeSteps[0], status: TestCaseStatus.FAILURE }],
        },
      ],
      linkSetInstances: [
        {
          linkSet: stored(),
          assessment: assessmentOf([schemaStep(TestCaseStatus.SUCCESS), pending], TestCaseStatus.SUCCESS),
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(withFailingScheme.pass).toBe(false);
    expect(withFailingScheme.linkSets[0].status).toBe(TestCaseStatus.SUCCESS);
  });

  it('copies a verified credential source through to the JSON, link set provenance included (#814)', async () => {
    const report = await generateReport({
      implementationName: 'Acme',
      credentialInstances: [
        {
          credential: {
            ...mockCredentialInstance.credential,
            source: {
              kind: 'url',
              url: 'https://c.example.org/dpp.json',
              via: 'link-set',
              linkSet: 'https://r.example.org/01/1?linkType=all',
            },
          },
          steps: mockCredentialInstance.steps,
        },
      ],
      passStatuses: mockPassStatuses,
    });
    expect(JSON.parse(JSON.stringify(report.verifiableCredentials[0])).source).toEqual({
      kind: 'url',
      url: 'https://c.example.org/dpp.json',
      via: 'link-set',
      linkSet: 'https://r.example.org/01/1?linkType=all',
    });
  });
});
