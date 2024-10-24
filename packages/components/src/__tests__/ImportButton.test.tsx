/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable jest/no-conditional-expect */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportButton } from '../components/ImportButton/ImportButton';
import { processVerifiableCredentialData } from '../utils/importDataHelpers.js';
import { ImportDataType } from '../types/common.types';

jest.mock('../utils/importDataHelpers.js', () => ({
  processVerifiableCredentialData: jest.fn(),
}));

describe('ImportButton, when type is JSON', () => {
  // Mock Json object
  const contentObjectMock = {
    pdfUrl: 'https://integritysystems.com.au/api/v1/kqUvtmA',
    number: 'C-12345678',
    forms: [
      {
        serialNumber: '12345678',
        type: 'TPEC1',
      },
    ],
  };
  const fileMock = new File([JSON.stringify(contentObjectMock)], 'testFile.json', {
    type: 'application/json',
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders ImportButton component', () => {
    // Mock function to be used as the 'onChange' callback
    const onChangeMock = jest.fn();
    const label = 'Import JSON File';

    // Render the ImportButton component with the provided props
    render(<ImportButton label={label} onChange={onChangeMock} type={ImportDataType.JSON} />);

    // Expect that the rendered button is present in the document
    const renderedImportButton = screen.getByText(label);
    expect(renderedImportButton).toBeInTheDocument();
  });

  it('handles file upload and calls onChange with file content', async () => {
    render(
      <ImportButton
        type={ImportDataType.JSON}
        onChange={(data: object[]) => {
          const [fileContentObject] = data;
          // Expect the onChange function to have been called with the expected content
          expect(fileContentObject).toMatchObject({ 'testFile.json': contentObjectMock });
        }}
      />,
    );

    const fileInput = screen.getByLabelText('Import');
    fireEvent.change(fileInput, { target: { files: [fileMock] } });

    // Wait for the loading state to resolve
    await waitFor(() => expect(fileInput).not.toBeDisabled());
  });

  // TODO: The test does not work as expected because jest has no way of catching errors coming out of event handlers
  // ref: https://stackoverflow.com/questions/71978839/how-to-catch-such-an-error-with-jest-and-testing-library-react
  it.skip('handles file upload error due to exceeding maximum file size', async () => {
    try {
      const onChangeMock = jest.fn();

      const oversizedFileMock = new File(['file content'], 'oversizedFile.json', {
        type: 'application/json',
      });

      // Set the file size greater than the maximum allowed size (in bytes)
      Object.defineProperty(oversizedFileMock, 'size', { value: 1024 * 1024 * 6 });

      // Render the ImportButton component with the provided label and onChange mock function
      render(<ImportButton onChange={onChangeMock} type={ImportDataType.JSON} />);

      // Simulate a file change event by providing an oversized file to the file input
      const input = screen.getByTestId('file-input');
      fireEvent.change(input, {
        target: { files: [oversizedFileMock] },
      });
    } catch (error: any) {
      // Expect that the error message is correct
      expect(error.message).toBe('File size exceeds the maximum allowed size of 5 MB.');
    }
  });

  it('handles file upload error when content is empty', async () => {
    try {
      const onChangeMock = jest.fn();

      const emptyContentFileMock = new File([], 'emptyContentFile.json', {
        type: 'application/json',
      });

      // Render the ImportButton component with the provided label and onChange mock function
      render(<ImportButton onChange={onChangeMock} type={ImportDataType.JSON} />);

      // Simulate a file change event by providing a file with empty content to the file input
      const input = screen.getByTestId('file-input');
      fireEvent.change(input, {
        target: { files: [emptyContentFileMock] },
      });
    } catch (error: any) {
      // Expect that the error message is correct
      expect(error.message).toBe('File content is empty! Please select a valid file.');
    }
  });

  it('handles file upload error for invalid JSON file', async () => {
    try {
      const onChangeMock = jest.fn();

      const invalidJsonFileMock = new File(['{ invalid json }'], 'invalidJsonFile.json', {
        type: 'application/json',
      });

      // Render the ImportButton component with the provided label and onChange mock function
      render(<ImportButton onChange={onChangeMock} type={ImportDataType.JSON} />);

      // Simulate a file change event by providing a file with invalid JSON content to the file input
      const input = screen.getByTestId('file-input');
      fireEvent.change(input, {
        target: { files: [invalidJsonFileMock] },
      });
    } catch (error: any) {
      // Expect that the error message is correct
      expect(error.message).toMatch(/^Invalid JSON file! /);
    }
  });
});

describe('ImportButton, when type is VerifiableCredential', () => {
  // Mock Json object
  const contentObjectMock = {
    '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
    type: 'EnvelopedVerifiableCredential',
    id: 'data:application/vc-ld+jwt,jwt.abc.123',
  };
  const fileMock = new File([JSON.stringify(contentObjectMock, null, 2)], 'testFile.json', {
    type: 'application/json',
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders ImportButton component', () => {
    const onChangeMock = jest.fn();
    const label = 'Import Verifiable Credential';

    render(<ImportButton label={label} onChange={onChangeMock} type={ImportDataType.VerifiableCredential} />);

    const renderedImportButton = screen.getByText(label);
    expect(renderedImportButton).toBeInTheDocument();
  });

  it('handles file upload and calls onChange with file content', async () => {
    (processVerifiableCredentialData as jest.Mock).mockImplementation(() => ({
      vc: contentObjectMock,
      decodedEnvelopedVC: {
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:example:123',
          name: 'Alice',
        },
      },
    }));

    render(
      <ImportButton
        type={ImportDataType.VerifiableCredential}
        onChange={(data: object[]) => {
          const [fileContentObject] = data;
          expect(fileContentObject).toMatchObject({
            'testFile.json': {
              vc: contentObjectMock,
              decodedEnvelopedVC: {
                type: ['VerifiableCredential'],
                credentialSubject: {
                  id: 'did:example:123',
                  name: 'Alice',
                },
              },
            },
          });
        }}
      />,
    );

    const fileInput = screen.getByLabelText('Import');
    fireEvent.change(fileInput, { target: { files: [fileMock] } });

    await waitFor(() => expect(fileInput).not.toBeDisabled());
  });

  it;
});
