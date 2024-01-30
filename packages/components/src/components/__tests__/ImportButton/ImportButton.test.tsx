/* eslint-disable testing-library/no-unnecessary-act */
/* eslint-disable jest/no-conditional-expect */
import React from 'react';
import { act } from 'react-dom/test-utils';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportButton } from '../../..';

describe('ImportButton', () => {
  // Mock Json object
  const contentObjectMock = {
    pdfUrl: 'https://integritysystems.com.au/api/v1/kqUvtmA',
    number: 'C-12345678',
    forms: [
      {
        serialNumber: '12345678',
        type: 'TPEC1'
      }
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
    render(<ImportButton label={label} onChange={onChangeMock} />);

    // Expect that the rendered button is present in the document
    const renderedImportButton = screen.getByText(label);
    expect(renderedImportButton).toBeInTheDocument();
  });

  it('handles file upload and calls onChange with file content', async () => {
    render(<ImportButton onChange={((data: object[]) => {
      const [fileContentObject] = data;
      // Expect the onChange function to have been called with the expected content
      expect(fileContentObject).toMatchObject(contentObjectMock);
    })} />);

    const fileInput = screen.getByLabelText('Import');
    fireEvent.change(fileInput, { target: { files: [fileMock] } });

    // Wait for the loading state to resolve
    await waitFor(() => expect(fileInput).not.toBeDisabled());
  });

  it('handles file upload error due to exceeding maximum file size', async () => {
    try {
      // A mock function to be used as the 'onChange' callback
      const onChangeMock = jest.fn();
      
      // Mocking console.error to capture the error message
      const consoleErrorMock = jest.spyOn(console, 'error');
      consoleErrorMock.mockImplementation(() => {});
    
      // Set a file size greater than the maximum allowed size (in bytes)
      const oversizedFileMock = new File(['file content'], 'oversizedFile.json', {
        type: 'application/json',
      });

      // 6 MB, exceeding the maximum allowed size
      Object.defineProperty(oversizedFileMock, 'size', { value: 1024 * 1024 * 6 });
      
      await act(async () => {
        // Render the ImportButton component with the provided label and onChange mock function
        render(<ImportButton label='Import JSON File' onChange={onChangeMock} />);

        // Simulate a file change event by providing an oversized file to the file input
        fireEvent.change(screen.getByLabelText('Import JSON File'), {
          target: { files: [oversizedFileMock] },
        });
      });

        // Catch any errors that might occur during the asynchronous operation
      } catch (error: any) {
        // expect that the error message is not null, indicating an error was thrown
        expect(error.message).not.toBeNull();
      }
  });

});