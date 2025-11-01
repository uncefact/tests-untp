import { ReactNode } from 'react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface TooltipWrapperProps {
  content?: string;
  children: ReactNode;
  disabled?: boolean;
  dataTestId?: string;
}

export function TooltipWrapper({ content, children, disabled = false, dataTestId = 'default' }: TooltipWrapperProps) {
  if (!content || disabled) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={0}>
      <Tooltip disableHoverableContent>
        <TooltipTrigger asChild>
          <div data-testid={`${dataTestId}-tooltip-trigger`}>{children}</div>
        </TooltipTrigger>
        <TooltipContent data-testid={`${dataTestId}-tooltip-content`}>{content}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
