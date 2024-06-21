import React, { useCallback, useMemo, useState } from 'react';
import { Container, ThemeProvider } from '@mui/material';
import { Footer } from '@mock-app/components';

import Header from '../components/Header/Header';
import { Router } from '../components/Router';
import { ThemeSettings } from '../utils/theme';
import { GlobalContext } from '../hooks/GlobalContext';

function Layout() {
  const [selectedTheme, setSelectedTheme] = useState();
  const muiTheme = ThemeSettings(selectedTheme);

  const contextValue = useMemo(
    () => ({
      theme: {
        selectedTheme,
        setSelectedTheme,
      },
    }),
    [selectedTheme, setSelectedTheme],
  );

  return (
    <GlobalContext.Provider value={contextValue}>
      <ThemeProvider theme={muiTheme}>
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
      </ThemeProvider>
    </GlobalContext.Provider>
  );
}

export default Layout;
