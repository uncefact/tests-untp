import React from 'react';
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

});