'use client';

import { credentialIsTerminal } from '@/lib/credentialCollection';
import { downloadHtml } from '@/lib/reportDownload';
import { generateReport } from '@/lib/reportService';
import { downloadJson } from '@/lib/utils';
import {
  CredentialReportInput,
  DownloadReportFormat,
  LinkSetReportInput,
  SchemeReportInput,
  TestReport,
} from '@/types';
import { createContext, useContext, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { TestCaseStatus } from '../../constants';

interface TestReportContextType {
  canGenerateReport: boolean;
  canDownloadReport: boolean;
  report: TestReport | null;
  generateReport: (implementationName: string) => Promise<void>;
  downloadReport: (format: DownloadReportFormat) => void;
}

const TestReportContext = createContext<TestReportContextType | undefined>(undefined);

// Stable empty defaults so a consumer with no artefacts of a family does not churn the
// report-reset effect.
const NO_CREDENTIAL_INSTANCES: CredentialReportInput[] = [];
const NO_SCHEME_INSTANCES: SchemeReportInput[] = [];
const NO_LINK_SET_INSTANCES: LinkSetReportInput[] = [];

interface TestReportProviderProps {
  children: React.ReactNode;
  credentialInstances?: CredentialReportInput[];
  schemeInstances?: SchemeReportInput[];
  linkSetInstances?: LinkSetReportInput[];
}

export function TestReportProvider({
  children,
  credentialInstances = NO_CREDENTIAL_INSTANCES,
  schemeInstances = NO_SCHEME_INSTANCES,
  linkSetInstances = NO_LINK_SET_INSTANCES,
}: TestReportProviderProps) {
  const [report, setReport] = useState<TestReport | null>(null);

  const passStatuses = [TestCaseStatus.SUCCESS, TestCaseStatus.WARNING];

  // Invalidate any generated report whenever the loaded artefacts change, including when the last
  // one is removed, so a stale report cannot be downloaded for artefacts no longer loaded. The
  // link set input is rebuilt by the page whenever a link set, a URL binding or a credential
  // instance changes, so a coverage change on a card invalidates the report the same way (#814).
  useEffect(() => {
    setReport(null);
  }, [credentialInstances, schemeInstances, linkSetInstances]);

  // A report needs at least one loaded family, and every loaded credential and scheme must be
  // fully terminal (a non-empty result whose steps have all settled). A still-validating credential or scheme holds
  // generation rather than being recorded as a spurious pass or failure (ADR-041). A link set is
  // ready once its Schema Validation step has settled; its Link Type Coverage step is derived
  // from which links the verifier has fetched and may stay pending in the report (#814).
  const hasCredentials = credentialInstances.length > 0;
  const hasSchemes = schemeInstances.length > 0;
  const hasLinkSets = linkSetInstances.length > 0;

  const allCredentialsTerminal = credentialInstances.every(({ steps }) => credentialIsTerminal(steps ?? []));
  const allSchemesTerminal = schemeInstances.every(({ steps }) => credentialIsTerminal(steps ?? []));
  const allLinkSetsReady = linkSetInstances.every(
    ({ assessment }) => assessment !== undefined && !assessment.schemaRunning,
  );

  const canGenerateReport =
    (hasCredentials || hasSchemes || hasLinkSets) &&
    (!hasCredentials || allCredentialsTerminal) &&
    (!hasSchemes || allSchemesTerminal) &&
    (!hasLinkSets || allLinkSetsReady);

  const canDownloadReport = report !== null;

  const handleGenerateReport = async (implementationName: string) => {
    try {
      const newReport = await generateReport({
        implementationName,
        credentialInstances,
        schemeInstances,
        linkSetInstances,
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
