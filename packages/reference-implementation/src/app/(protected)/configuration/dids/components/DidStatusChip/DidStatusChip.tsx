'use client';

import { type ReactNode } from 'react';
import CheckIcon from '@mui/icons-material/Check';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import { DidStatus } from '@uncefact/untp-ri-services';

interface IDidStatusChip {
  status: DidStatus;
}

const STATUS_CONFIG: Record<DidStatus, { label: string; colour: string; icon?: ReactNode }> = {
  [DidStatus.ACTIVE]: {
    label: 'Ready',
    colour: 'text-black',
  },
  [DidStatus.VERIFIED]: {
    label: 'Verified',
    colour: 'text-[#15803D]',
    icon: <CheckIcon sx={{ fontSize: 24, color: '#15803D' }} />,
  },
  [DidStatus.UNVERIFIED]: {
    label: 'Unverified',
    colour: 'text-[#067971]',
  },
  [DidStatus.VERIFICATION_FAILED]: {
    label: 'Failed',
    colour: 'text-[#B91C1C]',
    icon: <ErrorOutlineIcon sx={{ fontSize: 24, color: '#B91C1C' }} />,
  },
  [DidStatus.INACTIVE]: {
    label: 'Inactive',
    colour: 'text-[#737373]',
  },
};

export default function DidStatusChip({ status }: IDidStatusChip) {
  const config = STATUS_CONFIG[status];

  return (
    <span className="inline-flex items-center gap-[10px] font-['Roboto',sans-serif] text-base leading-[22px]">
      {config.icon}
      <span className={config.colour}>{config.label}</span>
    </span>
  );
}
