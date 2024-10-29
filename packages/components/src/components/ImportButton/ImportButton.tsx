import React, { ChangeEvent, useState } from 'react';
import { Box } from '@mui/material';
import { LoadingButton } from '@mui/lab';
import { UploadFile as UploadFileIcon } from '@mui/icons-material';
import { ImportDataType } from '../../types/common.types.js';
import { processVerifiableCredentialData } from '../../utils/importDataHelpers.js';

export interface IImportButtonProps {
  onChange: (data: object[]) => void;
  label?: string;
  type?: ImportDataType;
  vcOptions?: {
    credentialPath: string;
    vckitAPIUrl?: string;
    headers?: Record<string, string>;
  };
}

/**
 * ImportButton component is used to display the footer
 */
export const ImportButton = ({
  label = 'Import',
  type = ImportDataType.VerifiableCredential,
  vcOptions,
  onChange,
}: IImportButtonProps) => {
  const [loading, setLoading] = useState<boolean>(false);

  const loadJsonFile = (file: File): Promise<object> => {
    const maxFileSizeMB = 5; // 5 MB

    return new Promise((resolve) => {
      if (file.size > maxFileSizeMB * 1024 * 1024) {
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
      const fileContents = await Promise.all(
        fileArray.map(async (file: File) => {
          const content = await loadJsonFile(file);
          if (type === ImportDataType.VerifiableCredential) {
            const { vckitAPIUrl, headers, credentialPath } = vcOptions || {};
            const processedData = await processVerifiableCredentialData(
              content,
              { vckitAPIUrl, headers },
              credentialPath,
            );
            return { [file.name]: processedData };
          }
          return { [file.name]: content };
        }),
      );

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
