'use client';

import { Footer } from '@reference-implementation/components';
import { Container } from '@mui/material';

import Header from '../../components/Header/Header';

// Navigation is hidden until the pages it links to exist; flip to true to reinstate (#715).
const SHOW_NAVIGATION = false;

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <Container
      sx={{
        mt: SHOW_NAVIGATION ? '64px' : '24px',
        mb: '24px',
      }}
    >
      {SHOW_NAVIGATION && <Header />}
      {children}
      <Footer />
    </Container>
  );
}
