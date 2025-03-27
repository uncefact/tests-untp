'use client';

import { Toaster } from 'sonner';
import { ErrorProvider } from '@/contexts/ErrorContext';

export function ClientLayout({ children }: { children: React.ReactNode }) {
  return (
    <ErrorProvider>
      <Toaster />
      {children}
    </ErrorProvider>
  );
}
