import { AlertCircle, Check, Loader2, X } from 'lucide-react';
import { TestCaseStatus } from '../../constants';

interface StatusIconProps {
  status: TestCaseStatus;
  size?: 'sm' | 'default';
  testId?: string;
}

export function StatusIcon({ status, size = 'default', testId = 'unknown' }: StatusIconProps) {
  const sizeClass = size === 'sm' ? 'h-3 w-3' : 'h-4 w-4';

  switch (status) {
    case TestCaseStatus.SUCCESS:
      return (
        <div data-testid={`${testId}-status-icon-success`}>
          <Check className={`${sizeClass} text-green-500`} />
        </div>
      );
    case TestCaseStatus.FAILURE:
      return (
        <div data-testid={`${testId}-status-icon-failure`}>
          <X className={`${sizeClass} text-red-500`} />
        </div>
      );
    case TestCaseStatus.IN_PROGRESS:
      return (
        <div data-testid={`${testId}-status-icon-in-progress`}>
          <Loader2 className={`${sizeClass} text-blue-500 animate-spin`} />
        </div>
      );
    case TestCaseStatus.PENDING:
    default:
      return (
        <div data-testid={`${testId}-status-icon-pending`}>
          <AlertCircle className={`${sizeClass} text-gray-400`} />
        </div>
      );
  }
}
