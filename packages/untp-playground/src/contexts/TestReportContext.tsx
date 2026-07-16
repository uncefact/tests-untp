'use client';

import { generateReport } from '@/lib/reportService';
import { downloadHtml, downloadJson } from '@/lib/utils';
import { DownloadReportFormat, SchemeReportInput, StoredCredential, TestReport, TestStep } from '@/types';
import { createContext, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CredentialType, TestCaseStatus } from '../../constants';

interface TestReportContextType {
  canGenerateReport: boolean;
  canDownloadReport: boolean;
  report: TestReport | null;
  generateReport: (implementationName: string) => Promise<void>;
  downloadReport: (format: DownloadReportFormat) => void;
}

const TestReportContext = createContext<TestReportContextType | undefined>(undefined);

// A stable empty default so a consumer with no schemes does not churn the report-reset effect.
const NO_SCHEME_INSTANCES: SchemeReportInput[] = [];

interface TestReportProviderProps {
  children: React.ReactNode;
  testResults: Partial<Record<CredentialType, TestStep[]>>;
  credentials: Partial<Record<CredentialType, StoredCredential>>;
  schemeInstances?: SchemeReportInput[];
}

export function TestReportProvider({
  children,
  testResults,
  credentials,
  schemeInstances = NO_SCHEME_INSTANCES,
}: TestReportProviderProps) {
  const [report, setReport] = useState<TestReport | null>(null);

  const allowedStatuses = [TestCaseStatus.SUCCESS, TestCaseStatus.FAILURE, TestCaseStatus.WARNING];
  const passStatuses = [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING];

  // Invalidate any generated report whenever the loaded artefacts change, including when the last
  // one is removed, so a stale report cannot be downloaded for artefacts no longer loaded.
  useEffect(() => {
    setReport(null);
  }, [credentials, schemeInstances]);

  // A report needs at least one loaded family, and every loaded family must be fully terminal (a
  // non-empty result whose steps have all settled). A still-validating credential or scheme holds
  // generation rather than being recorded as a spurious pass or failure (ADR-041).
  const isTerminal = (steps: TestStep[] | undefined) =>
    steps !== undefined && steps.length > 0 && steps.every((step) => allowedStatuses.includes(step.status));

  const hasCredentials = Object.values(credentials).some((cred) => cred && cred.decoded);
  const hasSchemes = schemeInstances.length > 0;

  const allCredentialsTerminal = (Object.keys(credentials) as CredentialType[]).every((type) => {
    const credential = credentials[type];
    if (!credential || !credential.decoded) return true;
    return isTerminal(testResults[type]);
  });
  const allSchemesTerminal = schemeInstances.every(({ steps }) => isTerminal(steps));

  const canGenerateReport =
    (hasCredentials || hasSchemes) &&
    (!hasCredentials || allCredentialsTerminal) &&
    (!hasSchemes || allSchemesTerminal);

  const canDownloadReport = report !== null;

  const handleGenerateReport = async (implementationName: string) => {
    try {
      const newReport = await generateReport({
        implementationName,
        credentials,
        testResults,
        schemeInstances,
        passStatuses,
      });

      setReport(newReport);
      toast.success('Report generated successfully');
    } catch (error) {
      console.error('Failed to generate report:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to generate report');
    }
  };

  const downloadReport = async (format: DownloadReportFormat) => {
    if (!report) {
      toast.error('No report available to download');
      return;
    }

    try {
      const filename = `untp-test-report-${report.implementation.name.toLowerCase().replace(/\s+/g, '-')}`;
      switch (format) {
        case DownloadReportFormat.JSON:
          downloadJson(report, filename);
          break;
        case DownloadReportFormat.HTML:
          await downloadHtml(report, filename);
          break;
        default:
          toast.error('Unsupported report format');
      }
    } catch (error) {
      console.error('Failed to download report:', error);
      toast.error('Failed to download report');
    }
  };

  return (
    <TestReportContext.Provider
      value={{
        canGenerateReport,
        canDownloadReport,
        report,
        generateReport: handleGenerateReport,
        downloadReport,
      }}
    >
      {children}
    </TestReportContext.Provider>
  );
}

export function useTestReport() {
  const context = useContext(TestReportContext);
  if (context === undefined) {
    throw new Error('useTestReport must be used within a TestReportProvider');
  }
  return context;
}
