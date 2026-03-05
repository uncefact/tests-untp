'use client';

import { useRuntimeConfig } from '@/contexts/RuntimeConfigContext';

export function Footer() {
  const { specUrl, testSuiteUrl } = useRuntimeConfig();

  return (
    <footer className='border-t mt-8'>
      <div className='container mx-auto p-8 max-w-7xl'>
        <div className='flex flex-col md:flex-row justify-center items-center gap-4 text-sm text-muted-foreground'>
          <a
            href={specUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-foreground transition-colors'
          >
            UNTP Specification
          </a>
          <span className='hidden md:inline'>•</span>
          <a
            href={testSuiteUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='hover:text-foreground transition-colors'
          >
            UNTP Test Suite
          </a>
        </div>
      </div>
    </footer>
  );
}
