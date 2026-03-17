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

  it.each([
    { status: DidStatus.ACTIVE, expectedClass: '.text-did-status-active' },
    { status: DidStatus.VERIFIED, expectedClass: '.text-did-status-verified' },
    { status: DidStatus.UNVERIFIED, expectedClass: '.text-did-status-unverified' },
    { status: DidStatus.VERIFICATION_FAILED, expectedClass: '.text-did-status-failed' },
    { status: DidStatus.INACTIVE, expectedClass: '.text-did-status-inactive' },
  ])('applies correct colour class for $status status', ({ status, expectedClass }) => {
    const { container } = render(<DidStatusChip status={status} />);
    expect(container.querySelector(expectedClass)).toBeInTheDocument();
  });
});
