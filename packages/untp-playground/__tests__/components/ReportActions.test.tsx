import { ReportActions } from '@/components/ReportActions';
import { useTestReport } from '@/contexts/TestReportContext';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/contexts/TestReportContext', () => ({
  useTestReport: jest.fn(),
}));

jest.mock('@/components/GenerateReportDialog', () => ({
  GenerateReportDialog: () => <div data-testid='generate-report'>Generate Report</div>,
}));

jest.mock('@/components/DownloadReport', () => ({
  DownloadReport: () => <button data-testid='download-report'>Download Report</button>,
}));

describe('ReportActions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders both the generate and download report actions', () => {
    (useTestReport as jest.Mock).mockReturnValue({ canDownloadReport: false });

    render(<ReportActions />);

    expect(screen.getByTestId('generate-report')).toBeInTheDocument();
    expect(screen.getByTestId('download-report')).toBeInTheDocument();
  });

  it('shows the "generate first" tooltip while a report cannot be downloaded yet', async () => {
    (useTestReport as jest.Mock).mockReturnValue({ canDownloadReport: false });

    render(<ReportActions />);
    await userEvent.hover(screen.getByTestId('download-report-button-tooltip-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('download-report-button-tooltip-content')).toHaveTextContent(
        'Generate a conformance report first to enable download',
      );
    });
  });

  it('shows the download tooltip once a report is available', async () => {
    (useTestReport as jest.Mock).mockReturnValue({ canDownloadReport: true });

    render(<ReportActions />);
    await userEvent.hover(screen.getByTestId('download-report-button-tooltip-trigger'));

    await waitFor(() => {
      expect(screen.getByTestId('download-report-button-tooltip-content')).toHaveTextContent(
        'Download the generated conformance report',
      );
    });
  });
});
