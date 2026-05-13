import '@testing-library/jest-dom';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ArtefactUploader } from '@/components/ArtefactUploader';
import { toast } from 'sonner';

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

const mockResetData = jest.fn();

jest.mock('@/contexts/ErrorContext', () => ({
  useError: jest.fn(() => ({
    resetErrors: mockResetData,
  })),
}));

describe('ArtefactUploader component', () => {
  const mockOnArtefactUpload = jest.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders the dropzone with the new copy and the URL paste form', () => {
    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    expect(screen.getByText(/drag and drop, or click to select/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Verifiable Credential \(JSON \/ JWT\) · Conformity Scheme \(JSON-LD\)/),
    ).toBeInTheDocument();
    expect(screen.getByTestId('artefact-url-input')).toBeInTheDocument();
    expect(screen.getByTestId('artefact-url-fetch')).toBeInTheDocument();
    expect(screen.getByText(/Maximum response size 10 MB/i)).toBeInTheDocument();
  });

  it('calls onArtefactUpload with the parsed JSON and a file source', async () => {
    const returnValue = { key: 'value' };
    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const validJsonFile = new File([JSON.stringify(returnValue)], 'valid.json', {
      type: 'application/json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [validJsonFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, { kind: 'file', filename: 'valid.json' });
    });
  });

  it('accepts .jsonld files as JSON', async () => {
    const returnValue = { '@context': 'https://example.org/ctx', type: ['ConformityScheme'] };
    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const schemeFile = new File([JSON.stringify(returnValue)], 'scheme.jsonld', {
      type: 'application/ld+json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [schemeFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, { kind: 'file', filename: 'scheme.jsonld' });
    });
  });

  it('displays an error for invalid file types', async () => {
    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');
    const invalidFile = new File(['content'], 'invalid.pdf', { type: 'application/pdf' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [invalidFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith(
      'Invalid file format. Please upload only .json, .jsonld, .jwt, or .txt files.',
    );
  });

  it('fetches a URL and calls onArtefactUpload with a url source', async () => {
    const returnValue = { type: ['ConformityScheme'] };
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        body: JSON.stringify(returnValue),
        contentType: 'application/ld+json',
        finalUrl: 'https://example.org/scheme.jsonld',
      }),
    });

    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    const urlInput = screen.getByTestId('artefact-url-input') as HTMLInputElement;
    const fetchButton = screen.getByTestId('artefact-url-fetch');

    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://example.org/scheme.jsonld' } });
    });
    await act(async () => {
      fireEvent.click(fetchButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(mockOnArtefactUpload).toHaveBeenCalledWith(returnValue, {
        kind: 'url',
        url: 'https://example.org/scheme.jsonld',
      });
    });
  });

  it('shows an inline error when the proxy reports the URL is blocked', async () => {
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, error: 'blocked', message: 'private host' }),
    });

    render(<ArtefactUploader onArtefactUpload={mockOnArtefactUpload} setFileCount={() => {}} />);
    const urlInput = screen.getByTestId('artefact-url-input') as HTMLInputElement;
    const fetchButton = screen.getByTestId('artefact-url-fetch');

    await act(async () => {
      fireEvent.change(urlInput, { target: { value: 'https://localhost/x' } });
    });
    await act(async () => {
      fireEvent.click(fetchButton);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(screen.getByTestId('artefact-url-error')).toHaveTextContent(/blocked/i);
    });
    expect(mockOnArtefactUpload).not.toHaveBeenCalled();
  });
});
