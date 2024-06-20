import React, { useCallback, useMemo, useState } from 'react';
import { Container, ThemeProvider } from '@mui/material';
import { Footer } from '@mock-app/components';

import Header from '../components/Header/Header';
import appConfig from '../constants/app-config.json';
import { Router } from '../components/Router';
import { ThemeSettings } from '../utils/theme';
import { ThemeContext } from '../hooks/ThemContext';

function Layout() {
  const [theme, setTheme] = useState();
  const muiTheme = ThemeSettings(theme ?? appConfig.styles);

  const toggleTheme = useCallback((newTheme: any) => {
    setTheme(newTheme);
  }, []);

  const contextValue = useMemo(
    () => ({
      theme,
      toggleTheme,
    }),
    [theme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={contextValue}>
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
    </ThemeContext.Provider>
  );
}

export default Layout;
