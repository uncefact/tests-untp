'use client';

import { testSuiteVersion } from '../../config';
import { useRuntimeConfig } from '@/contexts/RuntimeConfigContext';

export function Header() {
  const { headerTitle } = useRuntimeConfig();

  return (
    <header className='border-b'>
      <div className='container mx-auto p-8 max-w-7xl flex items-center gap-4'>
        <h1 className='text-2xl font-bold'>{headerTitle}</h1>
        <p className='text-sm text-muted-foreground'>v{testSuiteVersion}</p>
      </div>
    </header>
  );
}
