'use client';

import { Card } from '@/components/ui/card';
import { useError } from '@/contexts/ErrorContext';
import { jwtDecode } from 'jwt-decode';
import { useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { toast } from 'sonner';

export function CredentialUploader({
  onCredentialUpload,
  setFileCount,
}: {
  onCredentialUpload: (credential: any) => void;
  setFileCount: (count: number) => void;
}) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const { resetErrors } = useError();

  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      resetErrors();
      const validExtensions = ['.json', '.jwt', '.txt'];
      if (acceptedFiles.length > 1) {
        setFileCount(acceptedFiles.length);
      } else {
        setFileCount(1);
      }

      acceptedFiles.forEach((file) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
          try {
            const text = e.target?.result as string;
            let json;

            // Only try JWT parsing if the file extension is .jwt or .txt
            if (file.name.endsWith('.jwt') || file.name.endsWith('.txt')) {
              try {
                json = jwtDecode(text);
              } catch (jwtError) {
                console.log('Error decoding JWT:', jwtError);
                toast.error('Invalid JWT format - Please provide a file containing a valid JWT token');
                return;
              }
            } else {
              // For JSON files only
              try {
                json = JSON.parse(text);
              } catch (jsonError) {
                console.log('Error parsing JSON:', jsonError);
                toast.error('Invalid format - File must contain valid JSON');
                return;
              }
            }

            onCredentialUpload(json);
          } catch (error) {
            console.log('Error processing credential:', error);
            toast.error('Failed to process credential - Please ensure the file contains valid data');
          }
        };
        reader.readAsText(file);
      });
    },
    [onCredentialUpload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/json': ['.json'],
      'text/plain': ['.txt', '.jwt'],
    },
  });

  return (
    <Card
      {...getRootProps()}
      className='h-full p-8 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-gray-400 transition-colors flex items-center justify-center'
      data-testid='credential-upload'
    >
      <input {...getInputProps()} data-testid='credential-upload-input' />
      {isDragActive ? (
        <p className='text-center' data-testid='credential-upload-drop-text'>
          Drop the credentials here...
        </p>
      ) : (
        <p className='text-center' data-testid='credential-upload-drag-text'>
          Drag and drop credentials here, or click to select files
        </p>
      )}
    </Card>
  );
}
