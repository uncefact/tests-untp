import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

interface LoaderProps {
  text?: string;
  className?: string;
  size?: number;
}

/**
 * Loader component with optional text.
 *
 * Theme tokens used:
 * - text-loader: Color for the loader spinner icon
 * - text-loader-foreground: Text color for the loader text
 *
 * Test IDs:
 * - loader: Container for the loader
 * - loader-spinner: Spinner icon
 * - loader-text: Text below the spinner
 *
 */
export function Loader({ text, className, size = 40 }: LoaderProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-2', className)} data-testid='loader'>
      <Loader2 className='animate-spin text-loader' size={size} data-testid='loader-spinner' />
      {text && (
        <p className='text-sm text-loader-foreground' data-testid='loader-text'>
          {text}
        </p>
      )}
    </div>
  );
}
