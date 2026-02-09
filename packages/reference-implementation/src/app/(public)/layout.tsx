'use client';

import { Footer } from '@reference-implementation/components';
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
