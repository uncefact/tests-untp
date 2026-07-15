import { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  guidance: string;
}

/**
 * Borderless, centred placeholder shown in a tab's card-list column when that family
 * has no instances loaded. The surrounding panel provides no border or fill.
 */
export function EmptyState({ icon, title, guidance }: EmptyStateProps) {
  return (
    <div className='flex h-full min-h-[24rem] w-full flex-col items-center justify-center px-6 text-center'>
      {icon && <div className='mb-4 text-muted-foreground'>{icon}</div>}
      <p className='text-base font-medium'>{title}</p>
      <p className='mt-1 max-w-sm text-sm text-muted-foreground'>{guidance}</p>
    </div>
  );
}
