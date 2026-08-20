'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { resolveLinkSet } from '@/lib/resolveLinkSet';
import type { ArtefactSource } from '@/types';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';

/**
 * The Link Sets tab's resolver input (#811): a separate, labelled row because a resolver URL
 * points at an identifier, not a JSON document. The full tab-scoped uploader copy is #676; this
 * component is the resolve affordance that tab needs now.
 */
export function LinkSetResolver({
  onResolved,
}: {
  /**
   * The source URL is the normalised request URL, never the post-redirect one: it is the card's
   * identity, title, and caption (#811, ADR-046), so a resolver that redirects to a per-request
   * URL still replaces the same card and the user always sees the URL they asked to resolve.
   */
  onResolved: (payload: Record<string, unknown>, source: ArtefactSource) => void;
}) {
  const [urlInput, setUrlInput] = useState('');
  const [isResolving, setIsResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolve = async () => {
    setError(null);
    setIsResolving(true);
    try {
      const result = await resolveLinkSet(urlInput);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      onResolved(result.payload, { kind: 'url', url: result.requestUrl });
      setUrlInput('');
    } catch (err) {
      // resolveLinkSet never throws today; this guards ingestion (onResolved) and future edits so
      // an unexpected throw surfaces to the user instead of only resetting the busy state.
      console.error('LinkSetResolver: unexpected failure', err);
      setError('Something went wrong resolving that link set. Please try again.');
    } finally {
      setIsResolving(false);
    }
  };

  return (
    <div className='space-y-3'>
      <h2 className='text-xl font-semibold'>Resolve a link set</h2>
      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          void handleResolve();
        }}
      >
        <Input
          type='url'
          placeholder='https://resolver.example.org/01/09520123456788'
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isResolving}
          data-testid='linkset-resolver-input'
          className='flex-1'
        />
        <Button
          type='submit'
          disabled={isResolving || urlInput.trim().length === 0}
          data-testid='linkset-resolver-resolve'
          className='min-w-20'
        >
          {isResolving ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' /> : 'Resolve'}
        </Button>
      </form>
      {error && (
        <p className='text-sm text-red-600' role='alert' data-testid='linkset-resolver-error'>
          {error}
        </p>
      )}
      <p className='text-xs text-muted-foreground'>
        Point at an identity resolver. Unless the URL already carries a linkType, the playground requests the link set
        with <span className='font-mono'>?linkType=all</span> and shows the exact URL it requested on the card.
      </p>
    </div>
  );
}
