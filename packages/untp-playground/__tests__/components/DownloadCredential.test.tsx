import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadCredential } from '@/components/DownloadCredential';

// Mock the fetch function
global.fetch = jest.fn();
// Mock URL.createObjectURL and URL.revokeObjectURL
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

describe('DownloadCredential', () => {
  // Reset all mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock successful response
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ test: 'data' }),
    });
    (global.URL.createObjectURL as jest.Mock).mockReturnValue('blob:test-url');
  });

  it('renders download button with correct text and icon', () => {
    render(<DownloadCredential />);

    const button = screen.getByRole('button', { name: /download test credential/i });
    expect(button).toBeInTheDocument();
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('handles download click successfully', async () => {
    render(<DownloadCredential />);

    await act(async () => {
      const button = screen.getByRole('button');
      await fireEvent.click(button);
    });

    await waitFor(() => {
      // Check if fetch was called with correct path
      expect(fetch).toHaveBeenCalledWith('/credentials/dpp.json');

      // Verify Blob creation
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      const blobCall = (window.URL.createObjectURL as jest.Mock).mock.calls[0][0];
      expect(blobCall instanceof Blob).toBeTruthy();
      expect(blobCall.type).toBe('application/json');

      // Verify cleanup
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });

  it('handles download error gracefully', async () => {
    // Mock console.log to verify error logging
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    // Mock fetch to reject
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Download failed'));

    render(<DownloadCredential />);

    const button = screen.getByRole('button');
    await fireEvent.click(button);

    expect(consoleSpy).toHaveBeenCalledWith('Error downloading credential:', expect.any(Error));
  });
});
