'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useError } from '@/contexts/ErrorContext';
import { fetchErrorMessage } from '@/lib/fetchErrorMessages';
import { resolveLinkSet } from '@/lib/resolveLinkSet';
import { jwtDecode } from 'jwt-decode';
import { Loader2, Upload } from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';
import { API_BASE_PATH } from '../../constants';

export type ArtefactSource = { kind: 'file'; filename: string } | { kind: 'url'; url: string };

/**
 * The active tab's uploader copy and URL behaviour (#676). The two physical inputs (dropzone and
 * URL row) are identical on every tab; everything the user reads, and which flow the URL row
 * drives, follows the family. `urlMode: 'resolve'` sends the URL through the link set resolver
 * (`?linkType=all` normalisation, linkset Accept profile) instead of the generic document fetch.
 */
export interface UploaderFamilyConfig {
  heading: string;
  dropzoneSubtitle: string;
  divider: string;
  urlPlaceholder: string;
  urlAction: 'Fetch' | 'Resolve';
  urlMode: 'fetch' | 'resolve';
  helper: string;
}

export function ArtefactUploader({
  family,
  onArtefactUpload,
  setFileCount,
}: {
  family: UploaderFamilyConfig;
  onArtefactUpload: (artefact: unknown, source: ArtefactSource) => void;
  setFileCount: (count: number) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { resetErrors } = useError();

  const [urlInput, setUrlInput] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const handleFiles = useCallback(
    (acceptedFiles: File[]) => {
      resetErrors();
      const validExtensions = ['.json', '.jsonld', '.jwt', '.txt'];
      setFileCount(acceptedFiles?.length);

      const invalidFiles = acceptedFiles.filter(
        (file: File) => !validExtensions.some((ext) => file.name.toLowerCase().endsWith(ext)),
      );

      if (invalidFiles.length > 0 || acceptedFiles.length === 0) {
        toast.error('Invalid file format. Please upload only .json, .jsonld, .jwt, or .txt files.');
        return;
      }

      acceptedFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const text = e.target?.result as string;
            let json;

            if (file.name.endsWith('.jwt') || file.name.endsWith('.txt')) {
              try {
                json = jwtDecode(text);
              } catch (jwtError) {
                console.log('Error decoding JWT:', jwtError);
                toast.error('Invalid JWT format - Please provide a file containing a valid JWT token');
                return;
              }
            } else {
              try {
                json = JSON.parse(text);
              } catch (jsonError) {
                console.log('Error parsing JSON:', jsonError);
                toast.error('Invalid format - File must contain valid JSON');
                return;
              }
            }

            onArtefactUpload(json, { kind: 'file', filename: file.name });
          } catch (error) {
            console.log('Error processing artefact:', error);
            toast.error('Failed to process artefact - Please ensure the file contains valid data');
          }
        };
        reader.readAsText(file);
      });
    },
    [onArtefactUpload, resetErrors, setFileCount],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleFiles,
    // The extension superset is accepted on every tab; only the displayed subtitle narrows (#676
    // open decision). Narrowing per tab would reject a mis-named but valid document for no gain.
    accept: {
      'application/json': ['.json'],
      'application/ld+json': ['.jsonld'],
      'text/plain': ['.txt', '.jwt'],
    },
  });

  const handleFetch = useCallback(async () => {
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setFetchError('Enter a URL first.');
      return;
    }
    resetErrors();
    setFetchError(null);
    setIsFetching(true);
    try {
      if (family.urlMode === 'resolve') {
        const result = await resolveLinkSet(trimmed);
        if (!result.ok) {
          setFetchError(result.message);
          return;
        }
        setFileCount(1);
        onArtefactUpload(result.payload, { kind: 'url', url: result.requestUrl });
        setUrlInput('');
        return;
      }

      const response = await fetch(`${API_BASE_PATH}/api/fetch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const payload = (await response.json()) as
        | { ok: true; body: string; contentType: string | null; finalUrl: string }
        | { ok: false; error: string; message: string };

      if (!payload.ok) {
        setFetchError(fetchErrorMessage(payload.error, payload.message));
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(payload.body);
      } catch {
        setFetchError('The URL returned content that is not valid JSON.');
        return;
      }

      setFileCount(1);
      onArtefactUpload(parsed, { kind: 'url', url: payload.finalUrl });
      setUrlInput('');
    } catch (err) {
      console.error('ArtefactUploader: URL submission failed', err);
      setFetchError('Could not reach the URL. Check the address and try again.');
    } finally {
      setIsFetching(false);
    }
  }, [urlInput, family.urlMode, onArtefactUpload, resetErrors, setFileCount]);

  return (
    <div className='space-y-3'>
      <h2 className='text-xl font-semibold' data-testid='uploader-heading'>
        {family.heading}
      </h2>
      <Card
        {...getRootProps()}
        className='p-8 min-h-[200px] border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors flex flex-col items-center justify-center gap-3'
        data-testid='credential-upload'
      >
        <input {...getInputProps()} data-testid='credential-upload-input' />
        <Upload className='h-6 w-6 text-muted-foreground' aria-hidden='true' />
        {isDragActive ? (
          <p className='text-center font-medium' data-testid='credential-upload-drop-text'>
            Drop here
          </p>
        ) : (
          <>
            <p className='text-center font-medium' data-testid='credential-upload-drag-text'>
              Drag and drop, or click to select
            </p>
            <p className='text-center text-xs text-muted-foreground font-mono' data-testid='uploader-dropzone-subtitle'>
              {family.dropzoneSubtitle}
            </p>
          </>
        )}
      </Card>

      <div className='flex items-center gap-3 text-xs text-muted-foreground'>
        <div className='flex-1 border-t border-border' aria-hidden='true' />
        <span data-testid='uploader-divider'>{family.divider}</span>
        <div className='flex-1 border-t border-border' aria-hidden='true' />
      </div>

      <form
        className='flex gap-2'
        onSubmit={(e) => {
          e.preventDefault();
          void handleFetch();
        }}
      >
        <Input
          type='url'
          placeholder={family.urlPlaceholder}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isFetching}
          data-testid='artefact-url-input'
          className='flex-1'
        />
        <Button
          type='submit'
          // Enabled on an empty input so a click (or Enter) reaches the 'Enter a URL first.'
          // branch, per the #676 criterion; disabled only while a request is in flight.
          disabled={isFetching}
          data-testid='artefact-url-fetch'
          className='min-w-20'
        >
          {isFetching ? <Loader2 className='h-4 w-4 animate-spin' aria-hidden='true' /> : family.urlAction}
        </Button>
      </form>

      {fetchError && (
        <p className='text-sm text-red-600' role='alert' data-testid='artefact-url-error'>
          {fetchError}
        </p>
      )}

      <p className='text-xs text-muted-foreground' data-testid='uploader-helper'>
        {family.helper}
      </p>
    </div>
  );
}
