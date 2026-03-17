'use client';

import { DidMethod } from '@uncefact/untp-ri-services';

interface IDidMethodChip {
  method: DidMethod;
}

const METHOD_LABELS: Record<DidMethod, string> = {
  [DidMethod.DID_WEB]: 'did:web',
  [DidMethod.DID_WEB_VH]: 'did:web+vh',
};

export default function DidMethodChip({ method }: IDidMethodChip) {
  return <span className='text-base leading-[28px] text-foreground'>{METHOD_LABELS[method]}</span>;
}
