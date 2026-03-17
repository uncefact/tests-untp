'use client';

import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { DidStatus } from '@uncefact/untp-ri-services';

interface DidStatusChipProps {
  status: DidStatus;
}

const STATUS_CONFIG: Record<DidStatus, { label: string; colourClass: string; icon?: React.ReactNode }> = {
  [DidStatus.ACTIVE]: {
    label: 'Ready',
    colourClass: 'text-did-status-active',
  },
  [DidStatus.VERIFIED]: {
    label: 'Verified',
    colourClass: 'text-did-status-verified',
    icon: <CheckIcon className='text-did-status-verified' sx={{ fontSize: 24 }} />,
  },
  [DidStatus.UNVERIFIED]: {
    label: 'Unverified',
    colourClass: 'text-did-status-unverified',
  },
  [DidStatus.VERIFICATION_FAILED]: {
    label: 'Failed',
    colourClass: 'text-did-status-failed',
    icon: <ErrorOutlineIcon className='text-did-status-failed' sx={{ fontSize: 24 }} />,
  },
  [DidStatus.INACTIVE]: {
    label: 'Inactive',
    colourClass: 'text-did-status-inactive',
  },
};

export default function DidStatusChip({ status }: DidStatusChipProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span className='inline-flex items-center gap-2.5 text-base leading-snug'>
      {config.icon}
      <span className={config.colourClass}>{config.label}</span>
    </span>
  );
}
