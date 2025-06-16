import { ReactNode } from 'react';

interface SectionHeaderProps {
  title: string;
  children?: ReactNode;
}

export function SectionHeader({ title, children }: SectionHeaderProps) {
  return (
    <div className='flex items-center justify-between gap-4 mb-6'>
      <h2 className='text-xl font-semibold'>{title}</h2>
      <div className='flex gap-4'>{children}</div>
    </div>
  );
}
