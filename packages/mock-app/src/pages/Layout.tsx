import React from 'react';
import { Container } from '@mui/material';
import { Header } from '../components/Header';
import { Footer } from '@mock-app/components';
import { Router } from '../components/Router';

function Layout() {
  return (
    <Container
      sx={{
        mt: '64px',
        mb: '24px',
      }}
    >
      <Header />
      <Router />
      <Footer />
    </Container>
  );
}

export default Layout;
