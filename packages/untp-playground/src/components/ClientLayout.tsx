'use client';

import { Toaster } from 'sonner';
import { ErrorProvider } from '@/contexts/ErrorContext';
import { RuntimeConfigProvider, type RuntimeConfig } from '@/contexts/RuntimeConfigContext';

export function ClientLayout({
  runtimeConfig,
  children,
}: {
  runtimeConfig: RuntimeConfig;
  children: React.ReactNode;
}) {
  return (
    <RuntimeConfigProvider config={runtimeConfig}>
      <ErrorProvider>
        <Toaster />
        {children}
      </ErrorProvider>
    </RuntimeConfigProvider>
  );
}
