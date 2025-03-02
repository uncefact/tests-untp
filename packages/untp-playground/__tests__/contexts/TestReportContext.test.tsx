import { TestReportProvider, useTestReport } from '@/contexts/TestReportContext';
import { generateReport } from '@/lib/reportService';
import { downloadJson } from '@/lib/utils';
import { Credential, StoredCredential, TestReport, TestStep } from '@/types';
import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { CredentialType, TestCaseStatus, TestCaseStepId, VCDM_CONTEXT_URLS } from '../../constants';

jest.mock('@/lib/reportService');
jest.mock('@/lib/utils');
jest.mock('sonner');

const mockCredentials: Partial<Record<CredentialType, StoredCredential>> = {
  DigitalProductPassport: {
    original: {},
    decoded: {
      '@context': [VCDM_CONTEXT_URLS.v2],
      type: ['VerifiableCredential'],
    } as Credential,
  },
};

const mockTestResults: Partial<Record<CredentialType, TestStep[]>> = {
  DigitalProductPassport: [
    { id: TestCaseStepId.PROOF_TYPE, status: TestCaseStatus.SUCCESS, name: 'Test 1' },
    { id: TestCaseStepId.VERIFICATION, status: TestCaseStatus.SUCCESS, name: 'Test 2' },
  ],
};

const mockReport: TestReport = {
  implementation: { name: 'Test Implementation' },
  results: [],
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
    <TestReportProvider testResults={mockTestResults} credentials={mockCredentials}>
      {children}
    </TestReportProvider>
  );

  it('provides initial context values', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    expect(result.current.report).toBeNull();
    expect(result.current.canDownloadReport).toBeFalsy();
    expect(typeof result.current.generateReport).toBe('function');
    expect(typeof result.current.downloadReport).toBe('function');
  });

  it('allows report generation when all test results are valid', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });
    expect(result.current.canGenerateReport).toBeTruthy();
  });

  it('prevents report generation when tests are pending', () => {
    const pendingResults: Partial<Record<CredentialType, TestStep[]>> = {
      DigitalProductPassport: [{ id: TestCaseStepId.PROOF_TYPE, status: TestCaseStatus.PENDING, name: 'Test 1' }],
    };

    const { result } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider testResults={pendingResults} credentials={mockCredentials}>
          {children}
        </TestReportProvider>
      ),
    });

    expect(result.current.canGenerateReport).toBeFalsy();
  });

  it('generates report successfully', async () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    expect(generateReport).toHaveBeenCalledWith({
      implementationName: 'Test Implementation',
      credentials: mockCredentials,
      testResults: mockTestResults,
      passStatuses: [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING],
    });
    expect(toast.success).toHaveBeenCalledWith('Report generated successfully');
    expect(result.current.report).toEqual(mockReport);
    expect(result.current.canDownloadReport).toBeTruthy();
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

  it('downloads report successfully', async () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    act(() => {
      result.current.downloadReport();
    });

    expect(downloadJson).toHaveBeenCalledWith(mockReport, 'untp-test-report-test-implementation');
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
      result.current.downloadReport();
    });

    expect(toast.error).toHaveBeenCalledWith('Failed to download report');
  });

  it('prevents download when no report is available', () => {
    const { result } = renderHook(() => useTestReport(), { wrapper });

    act(() => {
      result.current.downloadReport();
    });

    expect(toast.error).toHaveBeenCalledWith('No report available to download');
    expect(downloadJson).not.toHaveBeenCalled();
  });

  it('resets report when credentials change', async () => {
    const { result, unmount } = renderHook(() => useTestReport(), { wrapper });

    await act(async () => {
      await result.current.generateReport('Test Implementation');
    });

    expect(result.current.report).toEqual(mockReport);

    // Unmount to cleanup
    unmount();

    const newCredentials: Partial<Record<CredentialType, StoredCredential>> = {
      DigitalProductPassport: {
        original: { new: true },
        decoded: {
          '@context': [VCDM_CONTEXT_URLS.v2],
          type: ['VerifiableCredential'],
        } as Credential,
      },
    };

    // Render with new credentials
    const { result: newResult } = renderHook(() => useTestReport(), {
      wrapper: ({ children }) => (
        <TestReportProvider testResults={mockTestResults} credentials={newCredentials}>
          {children}
        </TestReportProvider>
      ),
    });

    expect(newResult.current.report).toBeNull();
  });
});
