import React, { ChangeEvent, useState } from 'react';
import { Box } from '@mui/material';
import { LoadingButton } from '@mui/lab';
import { UploadFile as UploadFileIcon } from '@mui/icons-material';
import { BtnStyle } from '../../types/index.js';

export interface IImportButtonProps {
  onChange: (data: object[]) => void;
  label?: string;
  style?: BtnStyle;
}

/**
 * ImportButton component is used to display the footer
 */
export const ImportButton = ({ label = 'Import', onChange, ...props }: IImportButtonProps) => {
  const [loading, setLoading] = useState<boolean>(false);

  const loadJsonFile = (file: File): Promise<object> => {
    const maxFileSizeMB = 5;

    return new Promise((resolve) => {
      if (file.size > maxFileSizeMB * 1024 * 1024) {
        // 5 MB
        throw new Error(`File size exceeds the maximum allowed size of ${maxFileSizeMB} MB.`);
      }
      const fileReader = new FileReader();

      fileReader.onload = (event) => {
        const fileContent = event?.target?.result;
        try {
          if (!fileContent) {
            throw new Error('File content is empty! Please select a valid file.');
          }

          const fileContentObject = JSON.parse(fileContent as string);
          resolve(fileContentObject);
        } catch (error: any) {
          throw new Error(`Invalid JSON file! ${error.message}`);
        }
      };

      fileReader.onerror = () => {
        throw new Error('Error reading the file! Please try again.');
      };

      fileReader.readAsText(file);
    });
  };

  const handleFileUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    setLoading(true);

    try {
      const files = event.target.files;
      if (!files) {
        return;
      }

      const fileArray = Array.from(files);
      const fileContents = await Promise.all(fileArray.map((file: File) => loadJsonFile(file)));

      onChange(fileContents);
    } catch (error: any) {
      throw new Error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        paddingTop: '60px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          marginBottom: '20px',
        }}
      >
        <LoadingButton loading={loading} component='label' variant='outlined' startIcon={<UploadFileIcon />}>
          {label}
          <input data-testid='file-input' type='file' accept='.json' hidden onChange={handleFileUpload} multiple />
        </LoadingButton>
      </Box>
    </Box>
  );
};
