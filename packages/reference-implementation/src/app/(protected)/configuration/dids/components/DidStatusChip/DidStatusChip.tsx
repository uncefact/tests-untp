'use client';

import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { DidStatus } from '@uncefact/untp-ri-services';

interface IDidStatusChip {
  status: DidStatus;
}

const STATUS_CONFIG: Record<DidStatus, { label: string; colourClass: string; icon?: React.ReactNode }> = {
  [DidStatus.ACTIVE]: {
    label: 'Ready',
    colourClass: 'text-status-active',
  },
  [DidStatus.VERIFIED]: {
    label: 'Verified',
    colourClass: 'text-status-verified',
    icon: <CheckIcon className='text-status-verified' sx={{ fontSize: 24 }} />,
  },
  [DidStatus.UNVERIFIED]: {
    label: 'Unverified',
    colourClass: 'text-status-unverified',
  },
  [DidStatus.VERIFICATION_FAILED]: {
    label: 'Failed',
    colourClass: 'text-status-failed',
    icon: <ErrorOutlineIcon className='text-status-failed' sx={{ fontSize: 24 }} />,
  },
  [DidStatus.INACTIVE]: {
    label: 'Inactive',
    colourClass: 'text-status-inactive',
  },
};

export default function DidStatusChip({ status }: IDidStatusChip) {
  const config = STATUS_CONFIG[status];

  return (
    <span className='inline-flex items-center gap-[10px] text-base leading-[22px]'>
      {config.icon}
      <span className={config.colourClass}>{config.label}</span>
    </span>
  );
}
