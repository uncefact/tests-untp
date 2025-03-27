import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DownloadReport } from '@/components/DownloadReport';
import { useTestReport } from '@/contexts/TestReportContext';
import { DownloadReportFormat } from '@/types';

jest.mock('@/contexts/TestReportContext', () => ({
  useTestReport: jest.fn(),
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

describe('DownloadReport', () => {
  const mockUseTestReport = useTestReport as jest.MockedFunction<typeof useTestReport>;
  const mockDownloadReport = jest.fn();

  beforeEach(() => {
    (mockUseTestReport as jest.Mock).mockReturnValue({
      canDownloadReport: true,
      downloadReport: mockDownloadReport,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders the component', () => {
    render(<DownloadReport />);
    expect(screen.getByText('Download Report'));
  });

  it('disables the select trigger when canDownloadReport is false', () => {
    (mockUseTestReport as jest.Mock).mockReturnValueOnce({
      canDownloadReport: false,
      downloadReport: mockDownloadReport,
    });

    render(<DownloadReport />);
    screen.debug();
    const button = screen.getByRole('combobox');
    expect(button).toBeDisabled();
  });

  it('calls downloadReport with HTML format', () => {
    render(<DownloadReport />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('HTML'));
    expect(mockDownloadReport).toHaveBeenCalledWith(DownloadReportFormat.HTML);
  });

  it('calls downloadReport with JSON format', () => {
    render(<DownloadReport />);
    fireEvent.click(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText('JSON'));
    expect(mockDownloadReport).toHaveBeenCalledWith(DownloadReportFormat.JSON);
  });
});
