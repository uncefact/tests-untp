import * as React from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';

export function LoadingIndicator(): React.ReactElement {
  return (
    <Box
      sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',

        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <CircularProgress />
      <Box
        sx={{
          marginTop: '1rem',
        }}
      >
        <Typography sx={{ textAlign: 'center' }}>In progress...</Typography>
      </Box>
    </Box>
  );
}
