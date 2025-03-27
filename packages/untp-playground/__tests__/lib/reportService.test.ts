import { detectVersion } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { StoredCredential, TestStep } from '@/types';
import { reportName } from '../../config';
import { generateReport } from '@/lib/reportService';
import { CredentialType, TestCaseStatus, TestCaseStepId } from '../../constants';

jest.mock('@/lib/credentialService');
jest.mock('@/lib/schemaValidation');
jest.mock('../../config', () => ({
  ...jest.requireActual('../../config'),
  reportName: 'UNTP',
}));

describe('generateReport', () => {
  const mockImplementationName = 'Test Implementation';
  const mockCredentials = {
    DigitalProductPassport: {
      original: {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: 'EnvelopedVerifiableCredential',
        id: 'data:application/vc+jwt,eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvdjIiLCJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvZXhhbXBsZXMvdjIiXSwidHlwZSI6WyJWZXJpZmlhYmxlQ3JlZGVudGlhbCIsIkRpZ2l0YWxQcm9kdWN0UGFzc3BvcnQiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsibXlTdWJqZWN0UHJvcGVydHkiOiJteVN1YmplY3RWYWx1ZSJ9fQ',
      },
      decoded: {
        '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        type: ['VerifiableCredential', 'DigitalProductPassport'],
        credentialSubject: {
          mySubjectProperty: 'mySubjectValue',
        },
      },
    },
  };
  const mockTestResults: any = {
    DigitalProductPassport: [
      {
        id: 'proof-type',
        name: 'Proof Type Detection',
        status: 'success',
        details: {
          type: 'enveloping',
        },
      },
      {
        id: 'vcdm-version',
        name: 'VCDM Version Detection',
        status: 'success',
        details: {
          version: 'v2',
        },
      },
      {
        id: 'vcdm-schema-validation',
        name: 'VCDM Schema Validation',
        status: 'success',
        details: {
          valid: true,
          errors: [],
        },
      },
      {
        id: 'verification',
        name: 'Credential Verification',
        status: 'success',
        details: {
          verified: true,
        },
      },
      {
        id: 'untp-schema-validation',
        name: 'UNTP Schema Validation',
        status: 'success',
        details: {
          valid: true,
          errors: [],
        },
      },
    ],
  };
  const mockPassStatuses = [TestCaseStatus.SUCCESS];

  beforeEach(() => {
    (detectVersion as jest.Mock).mockReturnValue('1.0.0');
    (detectExtension as jest.Mock).mockReturnValue({
      core: { version: '1.0.0' },
      extension: { type: 'extensionType', version: '1.0.0' },
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should generate a report with valid credentials and test results', async () => {
    const report = await generateReport({
      implementationName: mockImplementationName,
      credentials: mockCredentials,
      testResults: mockTestResults,
      passStatuses: mockPassStatuses,
    });

    expect(report).toEqual({
      date: expect.any(String),
      reportName: 'UNTP',
      testSuite: {
        runner: 'untp-playground',
        version: '0.1.0',
      },
      implementation: {
        name: 'Test Implementation',
      },
      pass: true,
      results: [
        {
          status: 'success',
          credential: {
            '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
            type: 'EnvelopedVerifiableCredential',
            id: 'data:application/vc+jwt,eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvdjIiLCJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvZXhhbXBsZXMvdjIiXSwidHlwZSI6WyJWZXJpZmlhYmxlQ3JlZGVudGlhbCIsIkRpZ2l0YWxQcm9kdWN0UGFzc3BvcnQiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsibXlTdWJqZWN0UHJvcGVydHkiOiJteVN1YmplY3RWYWx1ZSJ9fQ',
          },
          core: {
            type: 'DigitalProductPassport',
            version: '1.0.0',
            steps: [
              {
                id: 'proof-type',
                name: 'Proof Type Detection',
                status: 'success',
                details: {
                  type: 'enveloping',
                },
              },
              {
                id: 'vcdm-version',
                name: 'VCDM Version Detection',
                status: 'success',
                details: {
                  version: 'v2',
                },
              },
              {
                id: 'vcdm-schema-validation',
                name: 'VCDM Schema Validation',
                status: 'success',
                details: {
                  valid: true,
                  errors: [],
                },
              },
              {
                id: 'verification',
                name: 'Credential Verification',
                status: 'success',
                details: {
                  verified: true,
                },
              },
              {
                id: 'untp-schema-validation',
                name: 'UNTP Schema Validation',
                status: 'success',
                details: {
                  valid: true,
                  errors: [],
                },
              },
            ],
          },
        },
      ],
    });
  });

  it('should throw an error if no valid credentials are provided', async () => {
    await expect(
      generateReport({
        implementationName: mockImplementationName,
        credentials: {},
        testResults: {},
        passStatuses: mockPassStatuses,
      }),
    ).rejects.toThrow('No valid credentials to generate report');
  });

  it('should generate a report with the extension', async () => {
    (detectExtension as jest.Mock).mockReturnValue({
      core: { version: '1.0.0' },
      extension: { type: 'extensionType', version: '1.0.0' },
    });

    const mockConfig = require('../../config');
    mockConfig.reportName = 'AATP';

    const testResults: any = {
      DigitalProductPassport: [
        {
          id: 'extension-schema-validation',
          name: 'Extension Schema Validation',
          status: 'success',
          details: {
            valid: true,
            errors: [],
          },
        },
        {
          id: 'context',
          name: 'JSON-LD Document Expansion and Context Validation',
          status: 'failure',
          details: {
            errors: [
              {
                keyword: 'const',
                message:
                  'Properties "credentialSubject/productImage/linkURL, credentialSubject/productImage/linkName, credentialSubject/producedByParty, credentialSubject/dimensions/weight, credentialSubject/dimensions/length, credentialSubject/dimensions/width, credentialSubject/dimensions/height, credentialSubject/dimensions/volume, credentialSubject/characteristic, credentialSubject/dueDiligenceDeclaration/linkURL, credentialSubject/dueDiligenceDeclaration/linkName, credentialSubject/circularityScorecard/recyclableContent, credentialSubject/circularityScorecard/recycledContent, credentialSubject/circularityScorecard/utilityFactor, credentialSubject/circularityScorecard/materialCircularityIndicator, credentialSubject/circularityScorecard/recyclingInformation, credentialSubject/circularityScorecard/repairInformation, credentialSubject/emissionsScorecard/carbonFootprint, credentialSubject/emissionsScorecard/declaredUnit, credentialSubject/emissionsScorecard/operationalScope, credentialSubject/emissionsScorecard/primarySourcedRatio, credentialSubject/emissionsScorecard/reportingStandard, render" are defined in the credential but missing from the context.',
                instancePath:
                  'credentialSubject/productImage/linkURL, credentialSubject/productImage/linkName, credentialSubject/producedByParty, credentialSubject/dimensions/weight, credentialSubject/dimensions/length, credentialSubject/dimensions/width, credentialSubject/dimensions/height, credentialSubject/dimensions/volume, credentialSubject/characteristic, credentialSubject/dueDiligenceDeclaration/linkURL, credentialSubject/dueDiligenceDeclaration/linkName, credentialSubject/circularityScorecard/recyclableContent, credentialSubject/circularityScorecard/recycledContent, credentialSubject/circularityScorecard/utilityFactor, credentialSubject/circularityScorecard/materialCircularityIndicator, credentialSubject/circularityScorecard/recyclingInformation, credentialSubject/circularityScorecard/repairInformation, credentialSubject/emissionsScorecard/carbonFootprint, credentialSubject/emissionsScorecard/declaredUnit, credentialSubject/emissionsScorecard/operationalScope, credentialSubject/emissionsScorecard/primarySourcedRatio, credentialSubject/emissionsScorecard/reportingStandard, render',
              },
            ],
          },
        },
      ],
    };

    const report = await generateReport({
      implementationName: mockImplementationName,
      credentials: mockCredentials,
      testResults: testResults,
      passStatuses: mockPassStatuses,
    });

    expect(report.reportName).toBe('AATP');
    expect(report.results[0].extension).toEqual({
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
});
