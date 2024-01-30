import React, { ChangeEvent, useState } from 'react';
import { Box } from '@mui/material';
import { LoadingButton } from '@mui/lab';
import { UploadFile as UploadFileIcon } from '@mui/icons-material';

interface IProps {
  label?: string;
  onChange: (data: object[]) => void;
}

/**
 * ImportButton component is used to display the footer
 */
export const ImportButton = ({ label = 'Import', onChange }: IProps) => {
  const [loading, setLoading] = useState<boolean>(false);

  const loadJsonFile = (file: File): Promise<object> => {
    return new Promise((resolve, reject) => {
      const fileReader = new FileReader();
  
      fileReader.onload = (event) => {
        const fileContent = event?.target?.result;
        try {
          if (!fileContent) {
            return reject('File content is empty! Please select a valid file.');
          }
  
          const fileContentObject = JSON.parse(fileContent as string);
          resolve(fileContentObject);
        } catch (error: any) {
          reject(`Invalid JSON file! ${error.message}`);
        }
      };
      fileReader.onerror = () => {
        reject('Error reading the file! Please try again.');
      };
  
      fileReader.readAsText(file);
    });
  }

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
        paddingTop: '40px',
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
        <LoadingButton
          loading={loading}
          component='label'
          variant='outlined'
          startIcon={<UploadFileIcon />}
          sx={{ margin: '0 5px' }}
        >
          {label}
          <input type='file' accept='.json' hidden onChange={handleFileUpload} multiple />
        </LoadingButton>
      </Box>
    </Box>
  );
};
