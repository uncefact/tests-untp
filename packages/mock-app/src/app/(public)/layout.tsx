'use client';

import { Footer } from '@mock-app/components';
import { Container } from '@mui/material';

import Header from '../../components/Header/Header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container
      sx={{
        mt: '64px',
        mb: '24px',
      }}
    >
      <Header />
      {children}
      <Footer />
    </Container>
  );
}
