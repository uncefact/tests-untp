'use client';

import { Button } from '@/components/ui/button';
import { downloadJson } from '@/lib/utils';
import { Download } from 'lucide-react';

export function DownloadCredential() {
  const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX;

  const testCredentialPath = `${assetPrefix ?? ''}/credentials/dpp.json`;
  const fileName = 'untp-test-dpp-credential.json';

  const handleDownload = async () => {
    try {
      const response = await fetch(testCredentialPath);
      const data = await response.json();

      downloadJson(data, fileName);
    } catch (error) {
      console.log('Error downloading credential:', error);
    }
  };

  return (
    <Button onClick={handleDownload} variant='outline'>
      <Download className='mr-2 h-4 w-4' />
      Download Test Credential
    </Button>
  );
}
