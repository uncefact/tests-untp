'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { Box, Button } from '@mui/material';

export interface IBackButton {
  children?: React.ReactNode;
  onNavigate?: VoidFunction;
  variant?: 'contained' | 'text' | 'outlined';
}

const BackButton = ({ children, onNavigate, variant = 'contained' }: IBackButton) => {
  const router = useRouter();

  const handleGoBack = () => {
    if (onNavigate) {
      onNavigate();
    }
    router.replace('/');
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Box
        sx={{
          marginTop: '1rem',
          textAlign: 'center',
          pb: 3,
        }}
      >
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          {children}
        </Box>

        {/* Retry button */}
        <Button onClick={handleGoBack} variant={variant}>
          Go back
        </Button>
      </Box>
    </Box>
  );
};

export default BackButton;
