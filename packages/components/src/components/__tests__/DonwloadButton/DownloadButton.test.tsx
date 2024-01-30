/* eslint-disable testing-library/no-node-access */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { DownloadButton, DownloadFileType } from '../../../';

describe('DownloadButton', () => {
  const jsonData = { key: 'value' };
  const plainTextData = 'This is plain text content.';
  const fileName = 'example';
  const fileExtensionJson = 'json';
  const fileExtensionTxt = 'txt';

  it('renders DownloadButton component with default button text', () => {
    render(
      <DownloadButton
        fileData={jsonData}
        fileName={fileName}
        fileExtension={fileExtensionJson}
        fileType={DownloadFileType.json}
      />
    );

    // Check if the rendered button with default text is in the document
    const renderedButton = screen.getByText('Download');
    expect(renderedButton).toBeInTheDocument();
  });

  it('renders DownloadButton component with custom button text', () => {
    const customLabel = 'Export';
    render(
      <DownloadButton
        label={customLabel}
        fileData={jsonData}
        fileName={fileName}
        fileExtension={fileExtensionJson}
        fileType={DownloadFileType.json}
      />
    );

    // Check if the rendered button with custom text is in the document
    const renderedButton = screen.getByText(customLabel);
    expect(renderedButton).toBeInTheDocument();
  });

  it('triggers download for JSON file', () => {
    // Mocking the createObjectURL function
    URL.createObjectURL = jest.fn();

    render(
      <DownloadButton
        fileData={jsonData}
        fileName={fileName}
        fileExtension={fileExtensionJson}
        fileType={DownloadFileType.json}
      />
    );

    // Find the download button and simulate a click
    const downloadButton = screen.getByText('Download');
    fireEvent.click(downloadButton);

    // Expect createObjectURL to have been called
    expect(URL.createObjectURL).toHaveBeenCalled();

    // Check if the download anchor element with the correct attributes is in the document
    const downloadFileAnchor = document.querySelector(`a[download="${fileName}.${fileExtensionJson}"]`);
    expect(downloadFileAnchor).toBeInTheDocument();
  });

  it('triggers download for plain text file', () => {
    render(
      <DownloadButton
        fileData={plainTextData}
        fileName={fileName}
        fileExtension={fileExtensionTxt}
        fileType={DownloadFileType.plainText}
      />
    );

    // Find the download button and simulate a click
    const downloadButton = screen.getByText('Download');
    fireEvent.click(downloadButton);

    // Check if the download anchor element with the correct attributes is in the document
    const downloadFileAnchor = document.querySelector(`a[download="${fileName}.${fileExtensionTxt}"]`);
    expect(downloadFileAnchor).toBeInTheDocument();
  });
});
