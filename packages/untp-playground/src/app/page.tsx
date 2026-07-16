'use client';

import { useMemo, useState } from 'react';
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
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import { credentialContentHash, credentialGroupType, credentialTitle } from '@/lib/credentialCollection';
import { newId } from '@/lib/id';
import { schemeContentHash, schemeTitle } from '@/lib/schemeCollection';
import { decodeEnvelopedCredential, detectArtefact, isEnvelopedProof } from '@/lib/credentialService';
import { isPermittedCredentialType, validateNormalizedCredential } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, StoredScheme, TestStep } from '@/types';
import { useError } from '@/contexts/ErrorContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Link2, Server } from 'lucide-react';
import { ArtefactKind, permittedCredentialTypes } from '../../constants';

export default function Home() {
  const credential = useArtefactCollection<StoredCredential, TestStep[]>();
  const scheme = useArtefactCollection<StoredScheme, TestStep[]>();
  const [fileCount, setFileCount] = useState(0);
  const { dispatchError, errors, setIsDetailsOpen } = useError();

  const shouldDisplayUploadDetailBtn = errors && errors.length > 0;

  // Whether each family has instances loaded. Both credentialsCount and schemesCount drive their
  // family's empty state and tab count, consistently (#845). linkSetsCount drives only the Link
  // Sets tab count; its empty state stays unconditional until #811 adds real data.
  const credentialsCount = credential.state.items.length;
  const schemesCount = scheme.state.items.length;
  const linkSetsCount = 0; // Link Sets family lands in #811.

  // Recomputed only when the instances change (add, replace, remove, or a result commit), so an
  // unrelated re-render does not create a fresh array and re-run the report-reset effect.
  const credentialInstances = useMemo(
    () => credential.state.items.map((item) => ({ credential: item.payload, steps: item.result ?? [] })),
    [credential.state.items],
  );
  const schemeInstances = useMemo(
    () => scheme.state.items.map((item) => ({ scheme: item.payload, steps: item.result ?? [] })),
    [scheme.state.items],
  );

  const handleArtefactUpload = async (rawArtefact: any, source?: ArtefactSource) => {
    try {
      const detected = detectArtefact(rawArtefact?.verifiableCredential ?? rawArtefact);

      if (detected?.kind === ArtefactKind.SCHEME) {
        const stored: StoredScheme = { original: rawArtefact, decoded: rawArtefact, source };
        const { outcome } = scheme.dispatch((state) =>
          upsert(state, { payload: stored, contentHash: schemeContentHash(stored.decoded), mintInstanceId: newId }),
        );
        if (outcome.kind === 'replaced') {
          toast.success(`Replaced ${schemeTitle(stored)}`);
        }
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

      const credentialType = credentialGroupType(decodedCredential);

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

      const stored: StoredCredential = { original: normalizedCredential, decoded: decodedCredential, source };
      const { outcome } = credential.dispatch((state) =>
        upsert(state, { payload: stored, contentHash: credentialContentHash(stored.decoded), mintInstanceId: newId }),
      );
      if (outcome.kind === 'replaced') {
        toast.success(`Replaced ${credentialTitle(stored)}`);
      }
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
          <Button onClick={() => setIsDetailsOpen(true)}>View Upload Detail</Button>
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
        <TestReportProvider credentialInstances={credentialInstances} schemeInstances={schemeInstances}>
          <SectionHeader title='Test artefacts'>
            <ReportActions />
          </SectionHeader>

          <Tabs defaultValue='credentials'>
            <TabsList>
              <TabsTrigger value='credentials'>
                Credentials
                {credentialsCount > 0 && (
                  <span className='text-xs tabular-nums text-muted-foreground'>{credentialsCount}</span>
                )}
              </TabsTrigger>
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
                    <TestResults collection={credential.state} dispatch={credential.dispatch} />
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
                    <SchemeTestResults collection={scheme.state} dispatch={scheme.dispatch} />
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
