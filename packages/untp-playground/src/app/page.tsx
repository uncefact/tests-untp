/* eslint-disable no-console */
'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { CredentialUploader } from '@/components/CredentialUploader';
import { DownloadCredential } from '@/components/DownloadCredential';
import { Footer } from '@/components/Footer';
import { Header } from '@/components/Header';

import { decodeEnvelopedCredential, detectCredentialType, isEnvelopedProof } from '@/lib/credentialService';
import { isPermittedCredentialType, validateNormalizedCredential } from '@/lib/utils';
import type { PermittedCredentialType, StoredCredential, TestStep } from '@/types';
import type { StreamEvent } from 'untp-test-suite-mocha/dist/untp-test/stream-reporter';
import { useError } from '@/contexts/ErrorContext';
import { Button } from '@/components/ui/button';
import { XCircle } from 'lucide-react';
import { permittedCredentialTypes } from '../../constants';

import * as defaultSchemaMappings from 'untp-test-suite-mocha/dist/untp-test/schema-mapper/default-mappings.json';

export default function Home() {
  const [credentials, setCredentials] = useState<StoredCredential[]>([]);
  const [testResults, setTestResults] = useState<{
    [key in PermittedCredentialType]?: TestStep[];
  }>({});
  const [fileCount, setFileCount] = useState(0);
  const { dispatchError, errors, setIsDetailsOpen } = useError();

  const [isMochaLoaded, setIsMochaLoaded] = useState(false);
  const [testLog, setTestLog] = useState('');

  const shouldDisplayUploadDetailBtn = errors && errors.length > 0;

  const handleDeleteCredential = (index: number) => {
    setCredentials(prev => prev.filter((_, i) => i !== index));
  };

  const [trustedIssuerDIDs, setTrustedIssuerDIDs] = useState<string[]>([]);

  const handleDeleteTrustedIssuerDID = (index: number) => {
    setTrustedIssuerDIDs(prev => prev.filter((_, i) => i !== index));
  };

  const handleAddTrustedIssuerDID = () => {
    const did = prompt('Enter Trusted Issuer DID');
    if (did) {
      setTrustedIssuerDIDs(prev => [...prev, did]);
    }
  };

  useEffect(() => {
    const setupMocha = async () => {
      try {
        (window as any).mocha.setup('bdd');
        await import('untp-test-suite-mocha/dist/untp-test/browser-bundle');

        // Poll until the test suites are registered
        const poll = (resolve: (value: unknown) => void, reject: (reason?: any) => void) => {
          if ((window as any).untpTestSuite && (window as any).untpTestSuite.registeredTestSuites && (window as any).untpTestSuite.registeredTestSuites.length === 3) {
            resolve(true);
          } else {
            setTimeout(() => poll(resolve, reject), 100);
          }
        };
        await new Promise(poll);


      } catch (error) {
        console.error('Failed to load scripts:', error);
        toast.error('Failed to load necessary scripts for validation.');
      }
    };

    setupMocha();
  }, []);




  const handleCredentialUpload = async ({ credential: rawCredential, fileName }: { credential: any; fileName: string }) => {
    try {
      if (!rawCredential) {
        throw new Error('Invalid credential format: credential is null or undefined.');
      }
      const normalizedCredential = rawCredential.verifiableCredential || rawCredential;
      const error = validateNormalizedCredential(normalizedCredential);

      if (error) {
        dispatchError([error]);
        return;
      }

      const isEnveloped = isEnvelopedProof(normalizedCredential);
      const decodedCredential = isEnveloped ? decodeEnvelopedCredential(normalizedCredential) : normalizedCredential;
      let credentialType = detectCredentialType(decodedCredential);
      if (!credentialType || !isPermittedCredentialType(credentialType as PermittedCredentialType)) {
        dispatchError([
          {
            keyword: 'required',
            instancePath: '/type',
            params: {
              missingProperty: `type array with a supported types:  ${permittedCredentialTypes.join(', ')}`,
              receivedValue: normalizedCredential,
              solution: "Add a valid UNTP credential type (e.g., 'DigitalProductPassport', 'ConformityCredential').",
            },
            message: `The credential type is missing or invalid.`,
          },
        ]);
        return;
      }

      setCredentials((prev) => ([
        ...prev,
        {
          original: normalizedCredential,
          decoded: decodedCredential,
          fileName,
        },
      ]));
    } catch (error) {
      console.error('Error in handleCredentialUpload:', error);
      toast.error('Failed to process credential');
    }
  };

  const runValidation = async () => {
    try {
      const credentialData = new Map();
      credentials.forEach(cred => {
        credentialData.set(cred.fileName, JSON.stringify(cred.decoded));
      });
      (window as any).untpTestSuite.setCredentialData(credentialData);

      (window as any).untpTestSuite.trustedDIDs.length = 0;
      (window as any).untpTestSuite.trustedDIDs.push(...trustedIssuerDIDs);

      const runner = new (window as any).untpTestSuite.UNTPTestRunner();
      const displayedSuites = new Set();

      const results = await runner.run({
        mochaSetupCallback: (mochaOptions: any) => {
          const newMocha = new (window as any).Mocha(mochaOptions);
          // Set up BDD interface globals (describe, it, etc.) for this instance
          newMocha.suite.emit('pre-require', window, null, newMocha);
          // Register the test suites with the new mocha instance
          (window as any).untpTestSuite.executeRegisteredTestSuites();
          return newMocha;
        }
      }, (event: StreamEvent) => {
        function showSuiteHierarchy(suiteHierarchy: any) {
          (window as any).untpTestSuite.showSuiteHierarchy(
            suiteHierarchy,
            displayedSuites,
            (suiteTitle: string, cleanTitle: string, tags: any, indentLevel: number) => {
              setTestLog(prevLog => prevLog + `${'  '.repeat(indentLevel)}${cleanTitle} ${tags}\n`);
            },
          );
        }
        function appendResult(text: string, indentLevel = 0) {
          setTestLog(prevLog => prevLog + `${'  '.repeat(indentLevel)}${text}\n`);
        }


        switch (event.type) {
          case 'start': {
            setTestLog('🚀 Running UNTP validation tests...\n');
            //displayedSuites.clear();
            break;
          }
          case 'pass': {
            showSuiteHierarchy(event.data.suiteHierarchy);
            const testDuration = event.data.duration ? ` (${event.data.duration}ms)` : '';
            const passIndent = event.data.suiteHierarchy.length;
            const { cleanTitle: cleanTestTitle, tags: testTags } = (window as any).untpTestSuite.formatTags(
              event.data.title,
            );
            appendResult(`✔ ${cleanTestTitle}${testTags}${testDuration}`, passIndent);
            break;
          }
          case 'fail': {
            showSuiteHierarchy(event.data.suiteHierarchy);
            const failIndent = event.data.suiteHierarchy.length;
            const { cleanTitle: cleanFailTitle, tags: failTestTags } = (window as any).untpTestSuite.formatTags(
              event.data.title,
            );
            appendResult(`✖ ${cleanFailTitle}${failTestTags}`, failIndent);
            if (event.data.err && event.data.err.message) {
              appendResult(event.data.err.message, failIndent + 1);
            }
            break;
          }
          case 'pending': {
            showSuiteHierarchy(event.data.suiteHierarchy);
            const pendingIndent = event.data.suiteHierarchy.length;
            const { cleanTitle: cleanPendingTitle, tags: pendingTestTags } = (window as any).untpTestSuite.formatTags(
              event.data.title,
            );
            appendResult(`- ${cleanPendingTitle}${pendingTestTags}`, pendingIndent);
            break;
          }
          case 'end': {
            console.log('UNTP Test End Event:', event.data);
            const stats = event.data;
            let summaryText = 'All finished.';
            if (stats.passes > 0) {
              summaryText += `${stats.passes} passing`;
            }
            if (stats.failures > 0) {
              if (summaryText) summaryText += ', ';
              summaryText += `${stats.failures} failing`;
            }
            if (stats.pending > 0) {
              if (summaryText) summaryText += ', ';
              summaryText += `${stats.pending} pending`;
            }
            if (summaryText) {
              summaryText += ` (${stats.duration || 0}ms)`;
              appendResult(summaryText);
            }
            break;
          }
          default: {
            // Fallback for any other event types
            appendResult(`Unknown event type '${event.type}': ${JSON.stringify(event.data)}`);
          }
        }
      });
      console.log('Test Results:', results);
    } catch (error) {
      console.error(error);
      toast.error('Failed to run validation');
    }
  };

  return (
    <div className='min-h-screen flex flex-col'>
      <Header />
      <main className='container mx-auto p-8 max-w-7xl flex-1'>
        <div className='flex flex-col flex-grow'>

          <div>
            <h2 className='text-xl font-semibold mb-6'>Add New Credential</h2>
            <div className='mb-6'>
              <CredentialUploader
                onCredentialUpload={handleCredentialUpload}
                setFileCount={setFileCount}
                credentials={credentials}
                onDeleteCredential={handleDeleteCredential}
              />
            </div>
          </div>

          <div className='mb-6'>
            <h2 className='text-xl font-semibold mb-6'>Download Test Credential</h2>
            <DownloadCredential />
          </div>

        </div>

        <fieldset className="border p-4 rounded-md mb-6">
          <legend className="text-lg font-semibold px-2">Trusted Issuer DIDs</legend>
          <Button onClick={handleAddTrustedIssuerDID} variant="outline" size="sm" className="mb-4">
            Add Trusted Issuer DID
          </Button>
          <ul className="space-y-2">
            {trustedIssuerDIDs.map((did, index) => (
              <li key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                <span className="font-mono text-sm">{did}</span>
                <Button
                  onClick={() => handleDeleteTrustedIssuerDID(index)}
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          {trustedIssuerDIDs.length === 0 && (
            <p className="text-gray-500 text-sm italic">No trusted issuer DIDs added.</p>
          )}
        </fieldset>

        <div className='flex flex-col space-y-8'>

          <Button onClick={runValidation} className=''>
            Run Validation
          </Button>

          <h2 className='text-xl font-semibold mt-6'>Test Results</h2>
          <textarea
            id="test-log"
            className="w-full flex-grow p-2 border rounded mt-4 overflow-hidden"
            readOnly
            value={testLog}
            // TODO: field-sizing is not yet supported in firefox:
            // https://bugzilla.mozilla.org/show_bug.cgi?id=1977177
            // Until it is implemented in firefox, we include components/FirefoxTextareaResize.tsx
            // in layout.tsx as a polyfill.
            style={{ fieldSizing: "content", "--field-sizing": "content" } as React.CSSProperties}
          />

        </div>
      </main >
      <Footer />
    </div >
  );
}
