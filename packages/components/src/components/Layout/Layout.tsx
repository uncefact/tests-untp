import React from 'react';
import { Container } from '@mui/material';

interface IProps {
  children: React.ReactNode;
}

/**
 * Layout component is used to display the header and navigation to other pages
 */
export const Layout = ({ children }: IProps) => {
  return (
    <Container
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        mt: '64px',
        mb: '24px',
      }}
    >
      {children}
    </Container>
  );
};
