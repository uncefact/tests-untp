import { detectCredentialType, detectVersion } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { CredentialReportInput } from '@/types';
import { reportName } from '../../config';
import { generateReport } from '@/lib/reportService';
import { TestCaseStatus } from '../../constants';

jest.mock('@/lib/credentialService');
jest.mock('@/lib/schemaValidation');
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
    (detectVersion as jest.Mock).mockReturnValue('1.0.0');
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
          overallStatus: 'success',
          credential: envelopedCredential,
          core: {
            type: 'DigitalProductPassport',
            version: '1.0.0',
            steps: mockCredentialInstance.steps,
          },
        },
      ],
    });
  });

  it('should throw an error if no valid credential or scheme instances are provided', async () => {
    await expect(
      generateReport({
        implementationName: mockImplementationName,
        credentialInstances: [],
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('No valid credentials or schemes to generate report');
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
    expect(report.verifiableCredentials[0].overallStatus).toBe(TestCaseStatus.FAILURE);
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
    expect(report.conformitySchemeResults).toHaveLength(1);
    expect(report.conformitySchemeResults?.[0]).toMatchObject({
      status: TestCaseStatus.SUCCESS,
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
    expect(report.conformitySchemeResults?.[0].status).toBe(TestCaseStatus.FAILURE);
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
            steps: [], // no settled steps yet
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
