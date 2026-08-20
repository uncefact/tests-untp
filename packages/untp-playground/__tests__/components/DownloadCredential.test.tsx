import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DownloadCredential } from '@/components/DownloadCredential';

global.fetch = jest.fn();
global.URL.createObjectURL = jest.fn();
global.URL.revokeObjectURL = jest.fn();

describe('DownloadCredential', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      json: () => Promise.resolve({ test: 'data' }),
    });
    (global.URL.createObjectURL as jest.Mock).mockReturnValue('blob:test-url');
  });

  it('renders only the active family sample (#676)', () => {
    render(<DownloadCredential family='credentials' />);

    expect(screen.getByRole('button', { name: /test credential \(dpp\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /conformity scheme/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /test link set/i })).not.toBeInTheDocument();
  });

  it('fetches the DPP sample on click', async () => {
    render(<DownloadCredential family='credentials' />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test credential \(dpp\)/i }));
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/samples/sample-digital-product-passport-v0.7.0.json');
      expect(window.URL.createObjectURL).toHaveBeenCalled();
      const blobCall = (window.URL.createObjectURL as jest.Mock).mock.calls[0][0];
      expect(blobCall instanceof Blob).toBeTruthy();
      expect(blobCall.type).toBe('application/json');
      expect(window.URL.revokeObjectURL).toHaveBeenCalledWith('blob:test-url');
    });
  });

  it('fetches the ConformityScheme sample on click', async () => {
    render(<DownloadCredential family='schemes' />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /conformity scheme/i }));
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/samples/sample-conformity-scheme-v0.7.0.json');
    });
  });

  it('fetches the Link Set sample on click', async () => {
    render(<DownloadCredential family='linksets' />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test link set/i }));
    });

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/samples/sample-link-set.json');
    });
  });

  it('logs the failed sample name on error', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    (global.fetch as jest.Mock).mockRejectedValue(new Error('Download failed'));

    render(<DownloadCredential family='credentials' />);
    await fireEvent.click(screen.getByRole('button', { name: /test credential \(dpp\)/i }));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Error downloading sample-digital-product-passport-v0.7.0.json:',
      expect.any(Error),
    );
  });
});
