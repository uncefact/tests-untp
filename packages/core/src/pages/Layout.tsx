import { Container } from '@mui/material';
import { Header } from '../components/Header';
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
    </Container>
  );
}

export default Layout;
