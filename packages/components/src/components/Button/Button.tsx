import { useState } from 'react';
import { LoadingButton } from '@mui/lab';
import { Box, Tooltip } from '@mui/material';

import { DownloadButton, DownloadFileType } from '../DownloadButton/DownloadButton.js';

type ButtonProps = {
  onClick: (handler: (args: any) => void) => void;
  label?: string;
  description?: string;
  includeDownload?: boolean;
  downloadFileName?: string;
};

export const CustomButton: React.FC<ButtonProps> = ({
  onClick,
  label = 'Submit',
  includeDownload = false,
  ...props
}) => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleOnClick = async () => {
    setLoading(true);

    try {
      await onClick(setResult);
      setLoading(false);
    } catch (error) {
      setLoading(false);
    }
  };

  return (
    <Box display='flex' justifyContent='center' p={1}>
      <Box p={1}>
        <Tooltip title={props.description}>
          <LoadingButton loading={loading} variant='contained' onClick={handleOnClick}>
            {label}
          </LoadingButton>
        </Tooltip>
      </Box>
      {includeDownload && result && props.downloadFileName ? (
        <Box p={1}>
          <DownloadButton
            fileData={result}
            fileName={props.downloadFileName!}
            fileExtension='json'
            fileType={DownloadFileType.json}
          />
        </Box>
      ) : null}
    </Box>
  );
};
