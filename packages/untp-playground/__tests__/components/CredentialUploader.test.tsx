// packages/untp-playground/src/components/CredentialUploader.test.tsx
import '@testing-library/jest-dom';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { CredentialUploader } from '@/components/CredentialUploader';
import { toast } from 'sonner';

// Mock the toast library
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

describe('CredentialUploader component', () => {
  const mockOnCredentialUpload = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();
    JSON.parse = JSON.parse;
  });

  it('renders the CredentialUploader component', () => {
    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);
    const dropzoneElement = screen.getByText(/drag and drop credentials here/i);
    expect(dropzoneElement).toBeInTheDocument();
  });

  it('calls onCredentialUpload with valid JSON file', async () => {
    const returnValue = {
      key: 'value',
    };

    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const validJsonFile = new File([JSON.stringify(returnValue)], 'valid.json', {
      type: 'application/json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [validJsonFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(async () => {
      expect(mockOnCredentialUpload).toHaveBeenCalledWith(returnValue);
    });
  });

  it('displays an error for invalid JSON content', async () => {
    // JSON.parse = jest.fn().mockRejectedValue(new Error('Invalid JSON'));
    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const invalidJsonFile = new File(['invalid json'], 'invalid.json', {
      type: 'application/json',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [invalidJsonFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(toast.error).toHaveBeenCalledWith('Invalid format - File must contain valid JSON');
  });

  it('displays an error for invalid file types', async () => {
    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);
    // Find the input element of type file
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');
    const invalidFile = new File(['content'], 'invalid.pdf', { type: 'application/pdf' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [invalidFile] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(toast.error).toHaveBeenCalledWith('Invalid file format. Please upload only .json, .jwt, or .txt files.');
  });

  it('displays an error for invalid JWT content', async () => {
    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);
    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const invalidJwtFile = new File(['invalid jwt'], 'invalid.jwt', {
      type: 'text/plain',
    });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [invalidJwtFile] } });
      //   await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(async () => {
      expect(toast.error).toHaveBeenCalledWith(
        'Invalid JWT format - Please provide a file containing a valid JWT token',
      );
    });
  });

  it('shows generic error when credential processing fails', async () => {
    // Mock onCredentialUpload to throw an error
    const mockOnCredentialUpload = jest.fn().mockImplementation(() => {
      throw new Error('Some unexpected error');
    });
    render(<CredentialUploader onCredentialUpload={mockOnCredentialUpload} />);

    const inputElement = screen.getByRole('presentation').querySelector('input[type="file"]');

    const validJSON = JSON.stringify({ key: 'value' });
    const file = new File([validJSON], 'test.json', { type: 'application/json' });

    await act(async () => {
      fireEvent.change(inputElement as Element, { target: { files: [file] } });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        'Failed to process credential - Please ensure the file contains valid data',
      );
    });
  });
});
