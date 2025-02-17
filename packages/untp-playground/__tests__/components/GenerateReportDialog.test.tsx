import { GenerateReportDialog } from '@/components/GenerateReportDialog';
import { useTestReport } from '@/contexts/TestReportContext';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

jest.mock('@/contexts/TestReportContext');

describe('GenerateReportDialog', () => {
  const mockGenerateReport = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useTestReport as jest.Mock).mockReturnValue({
      canGenerateReport: true,
      generateReport: mockGenerateReport,
      report: null,
    });
  });

  it('renders generate report button', () => {
    render(<GenerateReportDialog />);
    expect(screen.getByText('Generate Report')).toBeInTheDocument();
  });

  it('disables button when report already exists', () => {
    (useTestReport as jest.Mock).mockReturnValue({
      canGenerateReport: true,
      generateReport: mockGenerateReport,
      report: { some: 'data' },
    });

    render(<GenerateReportDialog />);
    expect(screen.getByText('Generate Report')).toBeDisabled();
  });

  it('displays tooltip when report button is disabled', async () => {
    (useTestReport as jest.Mock).mockReturnValue({
      canGenerateReport: false,
      generateReport: mockGenerateReport,
      report: null,
    });
    
    render(<GenerateReportDialog />);

    const button = screen.getByTestId('generate-report-button-tooltip-trigger');
    userEvent.hover(button);

    await waitFor(() => {
      const tooltipContent = screen.getByTestId('generate-report-button-tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
      expect(tooltipContent).toHaveTextContent('Upload and validate a credential to generate a conformance report');
    });
  });

  it('displays tooltip when report button is enabled', async () => {
    render(<GenerateReportDialog />);

    const button = screen.getByTestId('generate-report-button-tooltip-trigger');
    userEvent.hover(button);

    await waitFor(() => {
      const tooltipContent = screen.getByTestId('generate-report-button-tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
      expect(tooltipContent).toHaveTextContent('Generate UNTP conformance report');
    });
  });

  it('disables button when cannot generate report', () => {
    (useTestReport as jest.Mock).mockReturnValue({
      canGenerateReport: false,
      generateReport: mockGenerateReport,
      report: null,
    });

    render(<GenerateReportDialog />);
    expect(screen.getByText('Generate Report')).toBeDisabled();
  });

  it('opens dialog when button is clicked', () => {
    render(<GenerateReportDialog />);

    fireEvent.click(screen.getByText('Generate Report'));
    expect(screen.getByText('Generate Test Report')).toBeInTheDocument();
  });

  it('generates report with implementation name', async () => {
    render(<GenerateReportDialog />);

    fireEvent.click(screen.getByText('Generate Report'));

    const input = screen.getByPlaceholderText('Enter the name of your implementation');
    fireEvent.change(input, { target: { value: 'Test Implementation' } });

    fireEvent.click(screen.getByText('Generate'));

    await waitFor(() => {
      expect(mockGenerateReport).toHaveBeenCalledWith('Test Implementation');
    });
  });

  it('displays tooltip when generate button is disabled', async () => {
    render(<GenerateReportDialog />);

    fireEvent.click(screen.getByText('Generate Report'));

    const button = screen.getByTestId('dialog-generate-report-button-tooltip-trigger');
    userEvent.hover(button);

    await waitFor(() => {
      const tooltipContent = screen.getByTestId('dialog-generate-report-button-tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
      expect(tooltipContent).toHaveTextContent('Enter implementation details to generate a conformance report');
    });
  });

  it('disables generate button when implementation name is empty', () => {
    render(<GenerateReportDialog />);

    fireEvent.click(screen.getByText('Generate Report'));
    expect(screen.getByText('Generate')).toBeDisabled();
  });
});
