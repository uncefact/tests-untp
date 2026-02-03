'use client';

import { ThemeProvider } from '@mui/material';
import { SessionProvider } from 'next-auth/react';
import { useMemo, useState } from 'react';

import { GlobalContext, Theme } from '../hooks/GlobalContext';
import { ThemeSettings } from '../utils/theme';

export default function Providers({ children }: { children: React.ReactNode }) {
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
    <SessionProvider>
      <GlobalContext.Provider value={contextValue}>
        <ThemeProvider theme={muiTheme}>{children}</ThemeProvider>
      </GlobalContext.Provider>
    </SessionProvider>
  );
}
