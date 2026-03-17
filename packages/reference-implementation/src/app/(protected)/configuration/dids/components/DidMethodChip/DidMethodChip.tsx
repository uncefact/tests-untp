'use client';

import { DidMethod } from '@uncefact/untp-ri-services';

interface DidMethodChipProps {
  method: DidMethod;
}

const METHOD_LABELS: Record<DidMethod, string> = {
  [DidMethod.DID_WEB]: 'did:web',
  [DidMethod.DID_WEB_VH]: 'did:web+vh',
};

export default function DidMethodChip({ method }: DidMethodChipProps) {
  return <span className='text-base leading-7 text-foreground'>{METHOD_LABELS[method]}</span>;
}
