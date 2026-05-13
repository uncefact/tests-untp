'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArtefactUploader, type ArtefactSource } from '@/components/ArtefactUploader';
import { DownloadCredential } from '@/components/DownloadCredential';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { TestResults } from '@/components/TestResults';
import { TestReportProvider } from '@/contexts/TestReportContext';
import {
  decodeEnvelopedCredential,
  detectArtefact,
  detectCredentialType,
  isEnvelopedProof,
} from '@/lib/credentialService';
import { detectExtension } from '@/lib/schemaValidation';
import { isPermittedCredentialType, validateNormalizedCredential } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, StoredScheme, TestStep } from '@/types';
import { useError } from '@/contexts/ErrorContext';
import { Button } from '@/components/ui/button';
import { ArtefactKind, permittedCredentialTypes, SchemeType } from '../../constants';

export default function Home() {
  const [credentials, setCredentials] = useState<{
    [key in PermittedCredentialType]?: StoredCredential;
  }>({});
  const [schemes, setSchemes] = useState<{
    [key in SchemeType]?: StoredScheme;
  }>({});
  const [testResults, setTestResults] = useState<{
    [key in PermittedCredentialType]?: TestStep[];
  }>({});
  const [schemeTestResults, setSchemeTestResults] = useState<{
    [key in SchemeType]?: TestStep[];
  }>({});
  const [fileCount, setFileCount] = useState(0);
  const { dispatchError, errors, setIsDetailsOpen } = useError();

  const shouldDisplayUploadDetailBtn = errors && errors.length > 0;

  const handleArtefactUpload = async (rawArtefact: any, source?: ArtefactSource) => {
    try {
      const detected = detectArtefact(rawArtefact?.verifiableCredential ?? rawArtefact);

      if (detected?.kind === ArtefactKind.SCHEME) {
        setSchemes((prev) => ({
          ...prev,
          [detected.type]: {
            original: rawArtefact,
            decoded: rawArtefact,
            source,
          },
        }));
        return;
      }

      const normalizedCredential = rawArtefact.verifiableCredential || rawArtefact;
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
          source,
        },
      }));
    } catch (error) {
      console.error(error);
      toast.error('Failed to process artefact');
    }
  };

  return (
    <div className='min-h-screen flex flex-col'>
      <Header />
      <main className='container mx-auto p-8 max-w-7xl flex-1'>
        <div className='flex flex-col md:flex-row gap-8'>
          <div className='md:w-2/3 space-y-10'>
            <TestReportProvider testResults={testResults} credentials={credentials}>
              <TestResults credentials={credentials} testResults={testResults} setTestResults={setTestResults} />
            </TestReportProvider>
            <SchemeTestResults
              schemes={schemes}
              testResults={schemeTestResults}
              setTestResults={setSchemeTestResults}
            />
          </div>
          <div className='md:w-1/3 flex flex-col space-y-8'>
            <div>
              <h2 className='text-xl font-semibold mb-6'>Add new artefact</h2>
              <ArtefactUploader onArtefactUpload={handleArtefactUpload} setFileCount={setFileCount} />
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
