'use client';

import { useTestReport } from '@/contexts/TestReportContext';

import { DownloadReport } from './DownloadReport';
import { GenerateReportDialog } from './GenerateReportDialog';
import { TooltipWrapper } from './TooltipWrapper';

/**
 * The report actions (generate + download) shown in the page header. A report spans
 * every artefact family, so these sit above the tab bar rather than inside any one
 * family's panel. Must render inside a TestReportProvider.
 */
export function ReportActions() {
  const { canDownloadReport } = useTestReport();

  return (
    <>
      <GenerateReportDialog />
      <TooltipWrapper
        content={
          !canDownloadReport
            ? 'Generate a conformance report first to enable download'
            : 'Download the generated conformance report'
        }
        dataTestId='download-report-button'
      >
        <DownloadReport />
      </TooltipWrapper>
    </>
  );
}
