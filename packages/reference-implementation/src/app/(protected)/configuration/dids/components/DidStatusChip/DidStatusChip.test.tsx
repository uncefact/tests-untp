import { render, screen } from '@testing-library/react';
import DidStatusChip from './DidStatusChip';
import { DidStatus } from '@uncefact/untp-ri-services';

jest.mock('@mui/icons-material/Check', () => {
  return function CheckIcon() {
    return <span data-testid='check-icon'>CheckIcon</span>;
  };
});

jest.mock('@mui/icons-material/ErrorOutline', () => {
  return function ErrorOutlineIcon() {
    return <span data-testid='error-icon'>ErrorOutlineIcon</span>;
  };
});

describe('DidStatusChip', () => {
  it('renders "Ready" for ACTIVE status', () => {
    render(<DidStatusChip status={DidStatus.ACTIVE} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('does not render an icon for ACTIVE status', () => {
    render(<DidStatusChip status={DidStatus.ACTIVE} />);
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-icon')).not.toBeInTheDocument();
  });

  it('renders "Verified" with check icon for VERIFIED status', () => {
    render(<DidStatusChip status={DidStatus.VERIFIED} />);
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('renders "Unverified" for UNVERIFIED status', () => {
    render(<DidStatusChip status={DidStatus.UNVERIFIED} />);
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('does not render an icon for UNVERIFIED status', () => {
    render(<DidStatusChip status={DidStatus.UNVERIFIED} />);
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-icon')).not.toBeInTheDocument();
  });

  it('renders "Failed" with error icon for VERIFICATION_FAILED status', () => {
    render(<DidStatusChip status={DidStatus.VERIFICATION_FAILED} />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByTestId('error-icon')).toBeInTheDocument();
  });

  it('renders "Inactive" for INACTIVE status', () => {
    render(<DidStatusChip status={DidStatus.INACTIVE} />);
    expect(screen.getByText('Inactive')).toBeInTheDocument();
  });

  it('does not render an icon for INACTIVE status', () => {
    render(<DidStatusChip status={DidStatus.INACTIVE} />);
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
    expect(screen.queryByTestId('error-icon')).not.toBeInTheDocument();
  });

  it('applies correct colour class for each status', () => {
    const { container: activeContainer } = render(<DidStatusChip status={DidStatus.ACTIVE} />);
    expect(activeContainer.querySelector('.text-black')).toBeInTheDocument();

    const { container: verifiedContainer } = render(<DidStatusChip status={DidStatus.VERIFIED} />);
    expect(verifiedContainer.querySelector('.text-\\[\\#15803D\\]')).toBeInTheDocument();

    const { container: unverifiedContainer } = render(<DidStatusChip status={DidStatus.UNVERIFIED} />);
    expect(unverifiedContainer.querySelector('.text-\\[\\#067971\\]')).toBeInTheDocument();

    const { container: failedContainer } = render(<DidStatusChip status={DidStatus.VERIFICATION_FAILED} />);
    expect(failedContainer.querySelector('.text-\\[\\#B91C1C\\]')).toBeInTheDocument();

    const { container: inactiveContainer } = render(<DidStatusChip status={DidStatus.INACTIVE} />);
    expect(inactiveContainer.querySelector('.text-\\[\\#737373\\]')).toBeInTheDocument();
  });
});
