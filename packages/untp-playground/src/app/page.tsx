'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';

import { ArtefactUploader, type ArtefactSource } from '@/components/ArtefactUploader';
import { UPLOADER_FAMILIES } from '@/lib/uploaderFamilies';
import { isEncryptedEnvelope } from '@/lib/encryptedEnvelope';
import { emptyUrlBindings, recordUrlBinding, type UrlBindings } from '@/lib/urlBindings';
import { DownloadCredential } from '@/components/DownloadCredential';
import { EmptyState } from '@/components/EmptyState';
import { LinkSetTestResults } from '@/components/LinkSetTestResults';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';
import { ReportActions } from '@/components/ReportActions';
import { SchemeTestResults } from '@/components/SchemeTestResults';
import { SectionHeader } from '@/components/SectionHeader';
import { TestResults } from '@/components/TestResults';
import { TestReportProvider } from '@/contexts/TestReportContext';
import { useArtefactCollection } from '@/hooks/useArtefactCollection';
import { upsert } from '@/lib/artefactCollection';
import {
  credentialContentHash,
  credentialGroupType,
  credentialIsTerminal,
  credentialTitle,
  instanceStatus,
} from '@/lib/credentialCollection';
import { newId } from '@/lib/id';
import { linkSetKey, linkSetTitle } from '@/lib/linkSetCollection';
import { schemeContentHash, schemeTitle } from '@/lib/schemeCollection';
import {
  acceptedArtefactFamilies,
  decodeEnvelopedCredential,
  isEnvelopedProof,
  isLinkSetShaped,
} from '@/lib/credentialService';
import { isPermittedCredentialType, validateNormalizedCredential } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, StoredLinkSet, StoredScheme, TestStep } from '@/types';
import { useError } from '@/contexts/ErrorContext';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FileText, Link2, Loader2, Server } from 'lucide-react';
import { ArtefactKind, permittedCredentialTypes, TestCaseStatus, type TabId } from '../../constants';

/**
 * Quiet per-tab meta (final hi-fi, canvas section 08): a muted tabular-nums instance count, a
 * small red dot before it when any instance in the family is failing, and a spinner (with the
 * count tinted to the in-progress colour) while the family is still verifying — wired up for
 * Credentials only, per the ticket and handoff. Renders nothing while the family is empty, so an
 * empty tab carries no meta at all.
 */
function TabMeta({
  family,
  count,
  failing = false,
  verifying = false,
}: {
  family: string;
  count: number;
  failing?: boolean;
  verifying?: boolean;
}) {
  if (count === 0) return null;
  return (
    // blue-700, not the StatusIcon spinner's blue-500: the tinted count is 12px text and must
    // clear WCAG 1.4.3's 4.5:1 on the white background (blue-500 is ~3.7:1; the handoff's
    // running-meta colour hsl(217 72% 42%) and blue-700 both clear it).
    <span
      className={`inline-flex items-center gap-1.5 text-xs tabular-nums ${
        verifying ? 'text-blue-700' : 'text-muted-foreground'
      }`}
    >
      {failing && (
        <>
          <span
            data-testid={`${family}-tab-failing-dot`}
            aria-hidden='true'
            className='h-1.5 w-1.5 rounded-full bg-red-500'
          />
          <span className='sr-only'>failing</span>
        </>
      )}
      {verifying && (
        <>
          <Loader2 data-testid={`${family}-tab-verifying`} aria-hidden='true' className='h-3 w-3 animate-spin' />
          <span className='sr-only'>verifying</span>
        </>
      )}
      {count}
    </span>
  );
}

export default function Home() {
  const credential = useArtefactCollection<StoredCredential, TestStep[]>();
  const scheme = useArtefactCollection<StoredScheme, TestStep[]>();
  const linkSet = useArtefactCollection<StoredLinkSet, TestStep[]>();
  const [fileCount, setFileCount] = useState(0);
  const [activeTab, setActiveTab] = useState<TabId>('credentials');
  // Which credential instance each URL's latest accepted ingestion produced (#812); the link set
  // rows read their state through this rather than matching sources, because content-hash
  // identity can append or re-source instances underneath a URL. See urlBindings.ts.
  const [urlBindings, setUrlBindings] = useState<UrlBindings>(emptyUrlBindings);
  const { dispatchError, errors, setIsDetailsOpen } = useError();

  const shouldDisplayUploadDetailBtn = errors && errors.length > 0;

  // Whether each family has instances loaded: drives that family's empty state and tab count.
  const credentialsCount = credential.state.items.length;
  const schemesCount = scheme.state.items.length;
  const linkSetsCount = linkSet.state.items.length;

  // Cross-tab signals for the tab meta: a family with any failing instance shows a red dot from
  // any tab, and the Credentials tab shows a spinner while any credential is still verifying
  // (a fresh instance with no result yet counts as verifying — its pipeline is about to run).
  const credentialsFailing = credential.state.items.some(
    (item) => instanceStatus(item.result) === TestCaseStatus.FAILURE,
  );
  const schemesFailing = scheme.state.items.some((item) => instanceStatus(item.result) === TestCaseStatus.FAILURE);
  const linkSetsFailing = linkSet.state.items.some((item) => instanceStatus(item.result) === TestCaseStatus.FAILURE);
  const credentialsVerifying = credential.state.items.some((item) => !credentialIsTerminal(item.result ?? []));

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

  // Shared ingestion for both link set entry points (file upload on the Link Sets tab, resolve via the
  // Link Sets tab). Identity is the resolver URL, else the filename (#811), so re-resolving the
  // same identifier replaces the card in place even when the response body changed.
  const ingestLinkSet = (payload: Record<string, unknown>, source?: ArtefactSource) => {
    const stored: StoredLinkSet = { original: payload, decoded: payload, source };
    const { outcome } = linkSet.dispatch((state) =>
      upsert(state, { payload: stored, contentHash: linkSetKey(source), mintInstanceId: newId }),
    );
    if (outcome.kind === 'replaced') {
      toast.success(`Replaced ${linkSetTitle(stored)}`);
    }
  };

  // The tab declares intent (#676): an upload validates as the active tab's family, with no
  // cross-family routing and no auto-switching. Detection only labels cards.
  // Returns the ingestion outcome so a caller driving a row (the link set Verify, #812) can gate
  // its own feedback and bind to the produced instance; rejections surface through dispatchError
  // either way.
  const handleCredentialUpload = (
    rawArtefact: any,
    source?: ArtefactSource,
  ): { accepted: false; encrypted?: true } | { accepted: true; instanceId: string } => {
    // A fetched body can legally parse to null; guard before property access so it reaches the
    // validator's own null handling instead of throwing (#812).
    const normalizedCredential = (rawArtefact && rawArtefact.verifiableCredential) || rawArtefact;
    // One encrypted classifier for every entry point (link set Verify, URL fetch, file upload):
    // an encrypted envelope is named as encrypted on the error surface, never walked into the
    // pipeline as an unclassified credential. Runs on the NORMALISED document, so a wrapper's
    // inner credential is judged rather than the wrapper. Decryption is the locked-card work (#813).
    if (isEncryptedEnvelope(normalizedCredential)) {
      dispatchError([
        {
          keyword: 'encrypted',
          instancePath: '',
          params: {
            receivedValue: source?.kind === 'url' ? source.url : 'the uploaded file',
            solution: 'Provide the decrypted credential, or wait for in-browser decryption, which is coming in v0.4.',
          },
          message: 'This credential is encrypted, so it cannot be validated yet.',
        },
      ]);
      return { accepted: false, encrypted: true };
    }
    const error = validateNormalizedCredential(normalizedCredential);

    if (error) {
      dispatchError([error]);
      return { accepted: false };
    }

    const isEnveloped = isEnvelopedProof(normalizedCredential);
    const decodedCredential = isEnveloped ? decodeEnvelopedCredential(normalizedCredential) : normalizedCredential;

    const credentialType = credentialGroupType(decodedCredential);

    if (!credentialType || !isPermittedCredentialType(credentialType as PermittedCredentialType)) {
      // The unclassified-artefact message names every accepted family, read from the detection
      // layer so a new family appears here automatically (#676).
      const acceptedFamiliesText = acceptedArtefactFamilies().join(', ');
      dispatchError([
        {
          keyword: 'required',
          instancePath: '/type',
          params: {
            missingProperty: `type array with a supported types:  ${permittedCredentialTypes.join(', ')}`,
            receivedValue: normalizedCredential,
            allowedValue: { type: ['VerifiableCredential', 'DigitalProductPassport'] },
            solution: `Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential'), or add the artefact on its own tab. The Playground accepts: ${acceptedFamiliesText}.`,
          },
          message: `The credential type is missing or invalid. The Playground accepts: ${acceptedFamiliesText}.`,
        },
      ]);
      return { accepted: false };
    }

    const stored: StoredCredential = { original: normalizedCredential, decoded: decodedCredential, source };
    const { outcome } = credential.dispatch((state) =>
      upsert(state, { payload: stored, contentHash: credentialContentHash(stored.decoded), mintInstanceId: newId }),
    );
    if (source?.kind === 'url') {
      // Both the requested URL and the post-redirect final URL name this ingestion, so a link set
      // row finds its instance whichever form it holds.
      setUrlBindings((bindings) => recordUrlBinding(bindings, [source.url, source.requestedUrl], outcome.instanceId));
    }
    if (outcome.kind === 'replaced' && !(source?.kind === 'url' && source.via === 'link-set')) {
      // The link set row narrates its own outcome; a second Replaced toast for the same click
      // would double-report.
      toast.success(`Replaced ${credentialTitle(stored)}`);
    }
    return { accepted: true, instanceId: outcome.instanceId };
  };

  const handleSchemeUpload = (rawArtefact: any, source?: ArtefactSource) => {
    const stored: StoredScheme = { original: rawArtefact, decoded: rawArtefact, source };
    const { outcome } = scheme.dispatch((state) =>
      upsert(state, { payload: stored, contentHash: schemeContentHash(stored.decoded), mintInstanceId: newId }),
    );
    if (outcome.kind === 'replaced') {
      toast.success(`Replaced ${schemeTitle(stored)}`);
    }
  };

  const handleLinkSetUpload = (rawArtefact: any, source?: ArtefactSource) => {
    // The link set family's only structural gate this phase: an RFC 9264 document has a top-level
    // linkset array. Anything else fails as a link set (the tab declared the intent), with the
    // accepted families named from the detection layer.
    if (!isLinkSetShaped(rawArtefact)) {
      toast.error(
        `That document is not a link set (no RFC 9264 "linkset" array). The Playground accepts: ${acceptedArtefactFamilies().join(
          ', ',
        )}. Add each on its own tab.`,
      );
      return;
    }
    ingestLinkSet(rawArtefact, source);
  };

  const uploadHandlers: Record<TabId, (rawArtefact: any, source?: ArtefactSource) => void> = {
    credentials: handleCredentialUpload,
    schemes: handleSchemeUpload,
    linksets: handleLinkSetUpload,
  };

  const handleArtefactUpload = async (rawArtefact: any, source?: ArtefactSource) => {
    try {
      // No family can do anything with ciphertext: gate encrypted envelopes before the tab
      // routing, so a JWE dropped on Conformity Schemes is named honestly instead of persisting
      // a string as a scheme card.
      if (isEncryptedEnvelope(rawArtefact)) {
        handleCredentialUpload(rawArtefact, source);
        return;
      }
      uploadHandlers[activeTab](rawArtefact, source);
    } catch (error) {
      console.error(error);
      toast.error('Failed to process artefact');
    }
  };

  // The whole sidebar is tab-scoped (#676): heading, dropzone subtitle, divider, URL placeholder
  // and verb, helper copy, and the sample download all follow the active tab.
  const sidebar = (
    <div className='flex flex-col space-y-8'>
      <ArtefactUploader
        family={UPLOADER_FAMILIES[activeTab]}
        onArtefactUpload={handleArtefactUpload}
        setFileCount={setFileCount}
      />
      {shouldDisplayUploadDetailBtn && (
        <div>
          <Button onClick={() => setIsDetailsOpen(true)}>View Upload Detail</Button>
        </div>
      )}
      <div>
        <h2 className='text-xl font-semibold mb-6'>Download test files</h2>
        <DownloadCredential family={activeTab} />
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

          <Tabs
            value={activeTab}
            // Radix types the callback as string; ignore any value outside the TabId tables so a
            // future trigger without table entries cannot crash the sidebar render.
            onValueChange={(value) => {
              if (value in UPLOADER_FAMILIES) setActiveTab(value as TabId);
            }}
          >
            <TabsList>
              <TabsTrigger value='credentials'>
                Credentials
                <TabMeta
                  family='credentials'
                  count={credentialsCount}
                  failing={credentialsFailing}
                  verifying={credentialsVerifying}
                />
              </TabsTrigger>
              <TabsTrigger value='schemes'>
                Conformity Schemes
                <TabMeta family='schemes' count={schemesCount} failing={schemesFailing} />
              </TabsTrigger>
              <TabsTrigger value='linksets'>
                Link Sets
                <TabMeta family='linksets' count={linkSetsCount} failing={linkSetsFailing} />
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
                  {linkSetsCount === 0 ? (
                    <EmptyState
                      icon={<Link2 size={28} />}
                      title='No link sets yet'
                      guidance='Add a link set from the panel on the right. Drop a JSON file or resolve from an identity resolver service. Each link set you add appears here.'
                    />
                  ) : (
                    <LinkSetTestResults
                      collection={linkSet.state}
                      dispatch={linkSet.dispatch}
                      // A row's Verify routes the fetched document through the same ingestion as a
                      // Credentials-tab upload (identity and dedupe per #810), with a link-set
                      // provenance source; the rows read the credentials collection back to show
                      // verifying/verified state without switching tabs (#812).
                      credentialItems={credential.state.items}
                      urlBindings={urlBindings}
                      onVerifyCredential={handleCredentialUpload}
                    />
                  )}
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
