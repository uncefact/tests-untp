'use client';

import { CredentialUploader } from '@/components/CredentialUploader';
import { DownloadCredential } from '@/components/DownloadCredential';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { TestResults } from '@/components/TestResults';
import { TestReportProvider } from '@/contexts/TestReportContext';
import { decodeEnvelopedCredential, detectCredentialType, isEnvelopedProof } from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { isPermittedCredentialType } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, TestStep } from '@/types';
import { useState } from 'react';
import { toast } from 'sonner';

export default function Home() {
  const [credentials, setCredentials] = useState<{
    [key in PermittedCredentialType]?: StoredCredential;
  }>({});
  const [testResults, setTestResults] = useState<{
    [key in PermittedCredentialType]?: TestStep[];
  }>({});

  const handleCredentialUpload = async (rawCredential: any) => {
    try {
      const normalizedCredential = rawCredential.verifiableCredential || rawCredential;

      if (!normalizedCredential || typeof normalizedCredential !== 'object') {
        toast.error('Invalid credential format');
        return;
      }

      const isEnveloped = isEnvelopedProof(normalizedCredential);
      const decodedCredential = isEnveloped ? decodeEnvelopedCredential(normalizedCredential) : normalizedCredential;

      const extension = detectExtension(decodedCredential);
      let credentialType = extension ? extension.core.type : detectCredentialType(decodedCredential);

      if (!credentialType || !isPermittedCredentialType(credentialType as PermittedCredentialType)) {
        toast.error('Unknown credential type');
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
                <CredentialUploader onCredentialUpload={handleCredentialUpload} />
              </div>
            </div>
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
