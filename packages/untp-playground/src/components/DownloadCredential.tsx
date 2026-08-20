'use client';

import { Button } from '@/components/ui/button';
import { downloadJson } from '@/lib/utils';
import { Download } from 'lucide-react';

interface SampleArtefact {
  label: string;
  path: string;
  fileName: string;
}

const SAMPLES: SampleArtefact[] = [
  {
    label: 'Test Credential (DPP)',
    path: '/samples/sample-digital-product-passport-v0.7.0.json',
    fileName: 'sample-digital-product-passport-v0.7.0.json',
  },
  {
    label: 'Test Conformity Scheme',
    path: '/samples/sample-conformity-scheme-v0.7.0.json',
    fileName: 'sample-conformity-scheme-v0.7.0.json',
  },
  {
    label: 'Test Link Set',
    path: '/samples/sample-link-set.json',
    fileName: 'sample-link-set.json',
  },
];

export function DownloadCredential() {
  const assetPrefix = process.env.NEXT_PUBLIC_ASSET_PREFIX ?? '';

  const handleDownload = async (sample: SampleArtefact) => {
    try {
      const response = await fetch(`${assetPrefix}${sample.path}`);
      const data = await response.json();
      downloadJson(data, sample.fileName);
    } catch (error) {
      console.log(`Error downloading ${sample.fileName}:`, error);
    }
  };

  return (
    <div className='flex flex-col gap-2'>
      {SAMPLES.map((sample) => (
        <Button key={sample.path} onClick={() => handleDownload(sample)} variant='outline' className='w-full'>
          <Download className='mr-2 h-4 w-4' />
          {sample.label}
        </Button>
      ))}
    </div>
  );
}
