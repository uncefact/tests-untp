'use client';

import { SessionProvider, useSession } from "next-auth/react";
import { Container, ThemeProvider, Typography, CircularProgress } from '@mui/material';
import React, { useMemo, useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { GlobalContext, Theme } from '../../hooks/GlobalContext';
import { ThemeSettings } from '../../utils/theme';

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

function ProtectedContent({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
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

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/api/auth/signin');
    }
  }, [status, router]);

  if (status === 'loading' || !session) {
    return (
          <Container
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: '100vh',
              gap: 2,
            }}
          >
            <CircularProgress size={40} />
            <Typography variant="body1" color="text.secondary">
              Loading...
            </Typography>
          </Container>
    );
  }

  return (
    <GlobalContext.Provider value={contextValue}>
      <ThemeProvider theme={muiTheme}>
        <Container
          sx={{
            mt: '24px',
            mb: '24px',
          }}
        >
          {children}
        </Container>
      </ThemeProvider>
    </GlobalContext.Provider>
  );
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  return (
    <SessionProvider>
      <ProtectedContent>{children}</ProtectedContent>
    </SessionProvider>
  );
}
