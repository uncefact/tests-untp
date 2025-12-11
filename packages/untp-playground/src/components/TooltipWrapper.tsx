'use client';

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import React from 'react';

interface TooltipWrapperProps {
  content: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  dataTestId?: string;
}

export function TooltipWrapper({ content, children, disabled = false, dataTestId = 'default' }: TooltipWrapperProps) {
  if (disabled) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <div data-testid={`${dataTestId}-tooltip-trigger`}>{children}</div>
        </TooltipTrigger>
        <TooltipContent data-testid={`${dataTestId}-tooltip-content`}>
          <p>{content}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
