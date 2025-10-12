'use client';

import { Footer } from '@mock-app/components';
import { Container, ThemeProvider } from '@mui/material';
import React, { useMemo, useState } from 'react';

import Header from '../components/Header/Header';
import { GlobalContext, Theme } from '../hooks/GlobalContext';
import { ThemeSettings } from '../utils/theme';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [selectedTheme, setSelectedTheme] = useState<Theme>();
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
    <html lang='en'>
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <GlobalContext.Provider value={contextValue}>
          <ThemeProvider theme={muiTheme}>
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
          </ThemeProvider>
        </GlobalContext.Provider>
      </body>
    </html>
  );
}
