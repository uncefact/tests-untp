'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CredentialUploader } from '@/components/CredentialUploader';
import { DownloadCredential } from '@/components/DownloadCredential';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { TestResults } from '@/components/TestResults';
import { TestReportProvider } from '@/contexts/TestReportContext';
import { decodeEnvelopedCredential, detectCredentialType, isEnvelopedProof } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { isPermittedCredentialType, validateNormalizedCredential } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, TestStep } from '@/types';
import { useError } from '@/contexts/ErrorContext';
import { Button } from '@/components/ui/button';
import { permittedCredentialTypes } from '../../constants';

export default function Home() {
  const [credentials, setCredentials] = useState<{
    [key in PermittedCredentialType]?: StoredCredential;
  }>({});
  const [testResults, setTestResults] = useState<{
    [key in PermittedCredentialType]?: TestStep[];
  }>({});
  const [fileCount, setFileCount] = useState(0);
  const { dispatchError, errors, setIsDetailsOpen } = useError();

const shouldDisplayUploadDetailBtn =
  errors && errors.length > 0 && ((fileCount === 1 && Object.keys(testResults).length === 0) || fileCount > 1);

  const handleCredentialUpload = async (rawCredential: any) => {
    resetState();

    try {
      const normalizedCredential = rawCredential.verifiableCredential || rawCredential;
      const error = validateNormalizedCredential(normalizedCredential);

      if (error) {
        dispatchError([error]);
        return;
      }

      const isEnveloped = isEnvelopedProof(normalizedCredential);
      const decodedCredential = isEnveloped ? decodeEnvelopedCredential(normalizedCredential) : normalizedCredential;

      const extension = detectExtension(decodedCredential);
      let credentialType = extension ? extension.core.type : detectCredentialType(decodedCredential);

      if (!credentialType || !isPermittedCredentialType(credentialType as PermittedCredentialType)) {
        dispatchError([
          {
            keyword: 'required',
            instancePath: '/type',
            params: {
              missingProperty: `type array with a supported types:  ${permittedCredentialTypes.join(', ')}`,
              receivedValue: normalizedCredential,
              allowedValue: { type: ['VerifiableCredential', 'DigitalProductPassport'] },
              solution: "Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential').",
            },
            message: `The credential type is missing or invalid.`,
          },
        ]);
        return;
      }

      setCredentials((prev) => ({
        ...prev,
        [credentialType]: {
          original: normalizedCredential,
          decoded: decodedCredential,
        },
      }));
    } catch (error) {
      console.error(error);
      toast.error('Failed to process credential');
    }
  };

  const resetState = () => {
    setTestResults({});
    setCredentials({});
  };

  useEffect(() => {
    if (credentials) {
      dispatchError([]);
    }
  }, [credentials]);

  return (
    <div className='min-h-screen flex flex-col'>
      <Header />
      <main className='container mx-auto p-8 max-w-7xl flex-1'>
        <div className='flex flex-col md:flex-row gap-8'>
          <div className='md:w-2/3'>
            <TestReportProvider testResults={testResults} credentials={credentials}>
              <TestResults credentials={credentials} testResults={testResults} setTestResults={setTestResults} />
            </TestReportProvider>
          </div>
          <div className='md:w-1/3 flex flex-col space-y-8'>
            <div>
              <h2 className='text-xl font-semibold mb-6'>Add New Credential</h2>
              <div className='h-[300px]'>
                <CredentialUploader onCredentialUpload={handleCredentialUpload} setFileCount={setFileCount} />
              </div>
            </div>
            {shouldDisplayUploadDetailBtn && (
              <div>
                <h2 className='text-sm font-semibold hover:cursor-pointer'>
                  <Button onClick={() => setIsDetailsOpen(true)}>View Upload Detail</Button>
                </h2>
              </div>
            )}

            <div>
              <h2 className='text-xl font-semibold mb-6'>Download Test Credential</h2>
              <DownloadCredential />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
