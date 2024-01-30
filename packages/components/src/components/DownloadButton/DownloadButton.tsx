import React from 'react';
import { Button } from '@mui/material';

export enum DownloadFileType {
  json = 'application/json',
  plainText = 'text/plain',
}

interface IProps {
  buttonText?: string,
  fileData: object | string;
  fileName: string;
  fileExtension: string;
  fileType: DownloadFileType;
}

export const DownloadButton = ({ buttonText = 'Download', fileData, fileName, fileExtension, fileType }: IProps) => {
  const handleClickDownload = () => {
    let data = fileData;
    if (fileType === DownloadFileType.json) {
      data = JSON.stringify(fileData, null, 2);
    }

    handleDownloadFile({ fileData: data, fileName, fileExtension, fileType });
  };

  return (
    <>
      <Button onClick={handleClickDownload} variant='contained'>
        {buttonText}
      </Button>
    </>
  );
};

/**
 * handle download file
 */

export function handleDownloadFile({ fileData, fileName, fileExtension, fileType }: IProps) {
  const element = document.createElement('a');
  const file = new Blob([fileData as string], {
    type: fileType,
  });

  element.href = URL.createObjectURL(file);
  element.download = `${fileName}.${fileExtension}`;
  document.body.appendChild(element); // Required for this to work in FireFox
  element.click();

  return element;
}
