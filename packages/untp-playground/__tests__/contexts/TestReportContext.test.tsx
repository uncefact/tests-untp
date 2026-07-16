import { TestReportProvider, useTestReport } from '@/contexts/TestReportContext';
import { generateReport } from '@/lib/reportService';
import { downloadJson, downloadHtml } from '@/lib/utils';
import { CredentialReportInput, DownloadReportFormat, TestReport } from '@/types';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { TestCaseStatus, TestCaseStepId, VCDM_CONTEXT_URLS } from '../../constants';

jest.mock('@/lib/reportService');
jest.mock('@/lib/utils');
jest.mock('sonner');

const credentialDoc = {
  '@context': [VCDM_CONTEXT_URLS.v2],
  type: ['VerifiableCredential', 'DigitalProductPassport'],
};

const terminalCredentialInstance: CredentialReportInput = {
  credential: { original: credentialDoc, decoded: credentialDoc },
  steps: [
    { id: TestCaseStepId.PROOF_TYPE, status: TestCaseStatus.SUCCESS, name: 'Test 1' },
    { id: TestCaseStepId.VERIFICATION, status: TestCaseStatus.SUCCESS, name: 'Test 2' },
  ],
};
const pendingCredentialInstance: CredentialReportInput = {
  credential: { original: credentialDoc, decoded: credentialDoc },
  steps: [{ id: TestCaseStepId.PROOF_TYPE, status: TestCaseStatus.PENDING, name: 'Test 1' }],
};

const schemeDoc = {
  '@context': ['https://vocabulary.uncefact.org/untp/0.7.0/context/'],
  type: ['ConformityScheme'],
};
const terminalSchemeInstance = {
  scheme: { original: schemeDoc, decoded: schemeDoc },
  steps: [{ id: TestCaseStepId.SCHEME_VERSION_DETECTION, status: TestCaseStatus.SUCCESS, name: 'Version Detection' }],
};
const pendingSchemeInstance = {
  scheme: { original: schemeDoc, decoded: schemeDoc },
  steps: [
    { id: TestCaseStepId.SCHEME_VERSION_DETECTION, status: TestCaseStatus.IN_PROGRESS, name: 'Version Detection' },
  ],
};

const mockReport: TestReport = {
  implementation: { name: 'Test Implementation' },
  reportName: 'UNTP',
  verifiableCredentials: [],
  date: new Date().toISOString(),
  testSuite: {
    runner: 'UNTP Playground',
    version: '1.0.0',
  },
  pass: true,
};

describe('TestReportContext', () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    (generateReport as jest.Mock).mockResolvedValue(mockReport);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <TestReportProvider credentialInstances={[terminalCredentialInstance]}>{children}</TestReportProvider>
  );

  it('provides initial context values', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    expect(result.current.report).toBeNull();
    expect(result.current.canDownloadReport).toBeFalsy();
    expect(typeof result.current.generateReport).toBe('function');
    expect(typeof result.current.downloadReport).toBe('function');
  });

  it('allows report generation when every credential instance is terminal', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });
    expect(result.current.canGenerateReport).toBeTruthy();
  });

  it('prevents report generation when a credential instance is still pending', () => {
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider credentialInstances={[pendingCredentialInstance]}>{children}</TestReportProvider>
      ),
    });

    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('does not allow generation while a scheme instance is still validating', () => {
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider schemeInstances={[pendingSchemeInstance]}>{children}</TestReportProvider>
      ),
    });
    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('allows generation when every loaded scheme instance is terminal', () => {
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider schemeInstances={[terminalSchemeInstance]}>{children}</TestReportProvider>
      ),
    });
    expect(result.current.canGenerateReport).toBeTruthy();
  });

  it('does not let a ready credential unlock generation while a scheme is still validating', () => {
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider
          credentialInstances={[terminalCredentialInstance]}
          schemeInstances={[pendingSchemeInstance]}
        >
          {children}
        </TestReportProvider>
      ),
    });
    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('prevents report generation when there are no loaded credentials or schemes', () => {
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => <TestReportProvider>{children}</TestReportProvider>,
    });
    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('invalidates a generated report when the last artefact is removed', async () => {
    let schemes = [terminalSchemeInstance];
    const { result, rerender } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => <TestReportProvider schemeInstances={schemes}>{children}</TestReportProvider>,
    });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });
    expect(result.current.report).toEqual(mockReport);

    schemes = [];
    rerender();

    expect(result.current.report).toBeNull();
    expect(result.current.canDownloadReport).toBe(false);
  });

  const runGenerateReportTest = async (expectedReport: any) => {
    (generateReport as jest.Mock).mockResolvedValue(expectedReport);

    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    expect(generateReport).toHaveBeenCalledWith({
      implementationName: 'Test Implementation',
      credentialInstances: [terminalCredentialInstance],
      schemeInstances: [],
      passStatuses: [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING],
    });
    expect(toast.success).toHaveBeenCalledWith('Report generated successfully');
    expect(result.current.report).toEqual(expectedReport);
    expect(result.current.canDownloadReport).toBeTruthy();
  };

  it('generates report successfully', async () => {
    await runGenerateReportTest(mockReport);
  });

  it('generates report with extension reportName successfully', async () => {
    const expectedReport = {
      ...mockReport,
      reportName: 'AATP',
    };
    await runGenerateReportTest(expectedReport);
  });

  it('handles report generation failure', async () => {
    const error = new Error('Generation failed');
    (generateReport as jest.Mock).mockRejectedValue(error);

    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    expect(toast.error).toHaveBeenCalledWith('Generation failed');
    expect(result.current.report).toBeNull();
    expect(result.current.canDownloadReport).toBeFalsy();
  });

  it('downloads report with JSON format successfully', async () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    act(() => {
      result.current.downloadReport(DownloadReportFormat.JSON);
    });

    expect(downloadJson).toHaveBeenCalledWith(mockReport, 'untp-test-report-test-implementation');
  });

  it('downloads report with HTML format successfully', async () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    act(() => {
      result.current.downloadReport(DownloadReportFormat.HTML);
    });

    expect(downloadHtml).toHaveBeenCalledWith(mockReport, 'untp-test-report-test-implementation');
  });

  it('handles download failure', async () => {
    const error = new Error('Download failed');
    (downloadJson as jest.Mock).mockImplementation(() => {
      throw error;
    });

    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    act(() => {
      result.current.downloadReport(DownloadReportFormat.JSON);
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to download report');
  });

  it('prevents download when no report is available', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    act(() => {
      result.current.downloadReport(DownloadReportFormat.JSON);
    });

    expect(toast.error).toHaveBeenCalledWith('No report available to download');
    expect(downloadJson).not.toHaveBeenCalled();
  });

  it('resets report when the loaded credential instances change', async () => {
    // Rerenders the SAME provider instance with a changed `credentialInstances` prop (mirroring
    // the scheme-removal test above), so this exercises the reset effect's dependency array
    // directly: mounting a fresh provider with different instances would pass regardless of
    // whether `credentialInstances` is actually a dependency of the effect.
    let credentials = [terminalCredentialInstance];
    const { result, rerender } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => <TestReportProvider credentialInstances={credentials}>{children}</TestReportProvider>,
    });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });
    expect(result.current.report).toEqual(mockReport);

    const newCredentialInstance: CredentialReportInput = {
      credential: { original: { ...credentialDoc, new: true }, decoded: { ...credentialDoc, new: true } },
      steps: terminalCredentialInstance.steps,
    };
    credentials = [newCredentialInstance];
    rerender();

    expect(result.current.report).toBeNull();
  });

  it('prevents report generation for a credential instance with no steps at all', () => {
    const emptyStepsInstance: CredentialReportInput = {
      credential: { original: credentialDoc, decoded: credentialDoc },
      steps: [],
    };
    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider credentialInstances={[emptyStepsInstance]}>{children}</TestReportProvider>
      ),
    });

    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('shows error toast when unsupported report format is selected', async () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    act(() => {
      // @ts-ignore: Argument of type '""' is not assignable to parameter of type 'DownloadReportFormat'.
      result.current.downloadReport('');
    });

    expect(toast.error).toHaveBeenCalledWith('Unsupported report format');
  });
});
