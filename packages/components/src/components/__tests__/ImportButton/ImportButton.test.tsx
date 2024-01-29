import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ImportButton, loadJsonFile } from '../../..';

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

  it('resolves with parsed JSON content for a valid file', async () => {
    // Call loadJsonFile with a mock file and await the result
    const resolvedValue = await loadJsonFile(fileMock);

    // Expect that the resolved value matches the expected content object
    expect(resolvedValue).toMatchObject(contentObjectMock);
  });

  it('rejects with an error for an empty file', async () => {
    // Create a mock file with an empty content
    const emptyFileMock = new File([], 'emptyFile.json', { type: 'application/json' });

    // Use expect with rejects.toThrow to assert that loadJsonFile throws the expected error
    await expect(loadJsonFile(emptyFileMock)).rejects.toEqual('File content is empty! Please select a valid file.');
  });

  it('renders ImportButton component', () => {
    // Mock function to be used as the 'onChange' callback
    const onChangeMock = jest.fn();
    const buttonText = 'Import JSON File';

    // Render the ImportButton component with the provided props
    render(<ImportButton buttonText={buttonText} onChange={onChangeMock} />);

    // Expect that the rendered button is present in the document
    const renderedImportButton = screen.getByText(buttonText);
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

});