import React from 'react';
import { Button } from '@mui/material';
import { BtnStyle } from '../../types/index.js';

export enum DownloadFileType {
  json = 'application/json',
  plainText = 'text/plain',
}

export interface IDownloadButtonProps {
  fileData: object | string;
  fileName: string;
  fileExtension: string;
  fileType: DownloadFileType;
  label?: string;
  downloadBtnStyle?: BtnStyle;
}

export const DownloadButton = ({
  label = 'Download',
  fileData,
  fileName,
  fileExtension,
  fileType,
  downloadBtnStyle,
}: IDownloadButtonProps) => {
  const handleDownloadFile = ({ fileData, fileName, fileExtension, fileType }: IDownloadButtonProps) => {
    const element = document.createElement('a');
    const file = new Blob([fileData as string], {
      type: fileType,
    });

    element.href = URL.createObjectURL(file);
    element.download = `${fileName}.${fileExtension}`;
    document.body.appendChild(element); // Required for this to work in FireFox
    element.click();

    return element;
  };

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
        {label}
      </Button>
    </>
  );
};
