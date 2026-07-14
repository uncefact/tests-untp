'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { ArtefactUploader, type ArtefactSource } from '@/components/ArtefactUploader';
import { DownloadCredential } from '@/components/DownloadCredential';
import { EmptyState } from '@/components/EmptyState';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { ReportActions } from '@/components/ReportActions';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { SectionHeader } from '@/components/SectionHeader';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Link2, Server } from 'lucide-react';
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

  // Whether each family has instances loaded. schemesCount drives both the Conformity Schemes
  // empty state and its tab count. credentialsCount drives only the Credentials empty state (that
  // tab has no count). linkSetsCount drives only the Link Sets tab count; its empty state stays
  // unconditional until #811 adds real data.
  const credentialsCount = Object.keys(credentials).length;
  const schemesCount = Object.keys(schemes).length;
  const linkSetsCount = 0; // Link Sets family lands in #811.

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

  // The shared sidebar (uploader + sample downloads), rendered once beside the tab panels.
  // Per-tab copy lands in #676. For now the same uploader serves every family.
  const sidebar = (
    <div className='flex flex-col space-y-8'>
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
        <h2 className='text-xl font-semibold mb-6'>Download test files</h2>
        <DownloadCredential />
      </div>
    </div>
  );

  return (
    <div className='min-h-screen flex flex-col'>
      <Header />
      <main className='container mx-auto p-8 max-w-7xl flex-1'>
        <TestReportProvider
          testResults={testResults}
          credentials={credentials}
          schemes={schemes}
          schemeTestResults={schemeTestResults}
        >
          <SectionHeader title='Test artefacts'>
            <ReportActions />
          </SectionHeader>

          <Tabs defaultValue='credentials'>
            <TabsList>
              <TabsTrigger value='credentials'>Credentials</TabsTrigger>
              <TabsTrigger value='schemes'>
                Conformity Schemes
                {schemesCount > 0 && <span className='text-xs tabular-nums text-muted-foreground'>{schemesCount}</span>}
              </TabsTrigger>
              <TabsTrigger value='linksets'>
                Link Sets
                {linkSetsCount > 0 && (
                  <span className='text-xs tabular-nums text-muted-foreground'>{linkSetsCount}</span>
                )}
              </TabsTrigger>
            </TabsList>

            {/* Panels stay force-mounted (hidden when inactive) so a family keeps validating even
                while its tab is not selected. The sidebar is shared, rendered once beside them. */}
            <div className='mt-6 flex flex-col md:flex-row gap-8'>
              <div className='md:w-2/3'>
                <TabsContent value='credentials' forceMount>
                  {credentialsCount === 0 ? (
                    <EmptyState
                      icon={<FileText size={28} />}
                      title='No credentials yet'
                      guidance='Add a credential from the panel on the right. Drop a JSON / JWT file or paste a URL. Each credential you add appears here and in the generated report.'
                    />
                  ) : (
                    <TestResults credentials={credentials} testResults={testResults} setTestResults={setTestResults} />
                  )}
                </TabsContent>

                <TabsContent value='schemes' forceMount>
                  {schemesCount === 0 ? (
                    <EmptyState
                      icon={<Server size={28} />}
                      title='No conformity schemes yet'
                      guidance='Add a scheme from the panel on the right. Drop a JSON-LD file or paste a URL. Each scheme you add appears here and in the generated report.'
                    />
                  ) : (
                    <SchemeTestResults
                      schemes={schemes}
                      testResults={schemeTestResults}
                      setTestResults={setSchemeTestResults}
                    />
                  )}
                </TabsContent>

                <TabsContent value='linksets' forceMount>
                  {/* Provisional Link Sets empty state. The final copy is an open decision in
                      #809 and is settled with the Link Sets family in #811. */}
                  <EmptyState
                    icon={<Link2 size={28} />}
                    title='No link sets yet'
                    guidance='Add a link set from the panel on the right. Drop a JSON file or resolve from an identity resolver service. Each link set you add appears here and in the generated report.'
                  />
                </TabsContent>
              </div>
              <div className='md:w-1/3'>{sidebar}</div>
            </div>
          </Tabs>
        </TestReportProvider>
      </main>
      <Footer />
    </div>
  );
}
