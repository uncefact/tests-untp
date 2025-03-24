'use client';

import { generateReport } from '@/lib/reportService';
import { downloadHtml, downloadJson } from '@/lib/utils';
import { DownloadReportFormat, StoredCredential, TestReport, TestStep } from '@/types';
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

interface TestReportProviderProps {
  children: React.ReactNode;
  testResults: Partial<Record<CredentialType, TestStep[]>>;
  credentials: Partial<Record<CredentialType, StoredCredential>>;
}

export function TestReportProvider({ children, testResults, credentials }: TestReportProviderProps) {
  const [report, setReport] = useState<TestReport | null>(null);

  const allowedStatuses = [TestCaseStatus.SUCCESS, TestCaseStatus.FAILURE, TestCaseStatus.WARNING];
  const passStatuses = [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING];

  // Reset report when credentials change
  useEffect(() => {
    const credentialValues = Object.values(credentials);
    const hasAnyCredential = credentialValues.some((cred) => cred && cred.decoded);
    if (hasAnyCredential) {
      setReport(null);
    }
  }, [credentials]);

  // Allow report generation if there are any credentials with allowed statuses
  const canGenerateReport =
    testResults &&
    Object.entries(testResults).every(([type, steps]) => {
      if (!steps) return true;
      const credential = credentials[type as CredentialType];

      if (!credential || !credential.decoded) return true;

      return steps.every((step) => allowedStatuses.includes(step.status));
    }) &&
    Object.entries(testResults).some(([type, steps]) => {
      const credential = credentials[type as CredentialType];
      return credential && credential.decoded && steps && steps.every((step) => allowedStatuses.includes(step.status));
    });

  const canDownloadReport = report !== null;

  const handleGenerateReport = async (implementationName: string) => {
    try {
      const newReport = await generateReport({
        implementationName,
        credentials,
        testResults,
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
