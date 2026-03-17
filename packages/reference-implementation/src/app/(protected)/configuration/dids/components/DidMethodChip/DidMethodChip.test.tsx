import { render, screen } from '@testing-library/react';
import DidMethodChip from './DidMethodChip';
import { DidMethod } from '@uncefact/untp-ri-services';

describe('DidMethodChip', () => {
  it('renders "did:web" for DID_WEB method', () => {
    render(<DidMethodChip method={DidMethod.DID_WEB} />);
    expect(screen.getByText('did:web')).toBeInTheDocument();
  });

  it('renders "did:web+vh" for DID_WEB_VH method', () => {
    render(<DidMethodChip method={DidMethod.DID_WEB_VH} />);
    expect(screen.getByText('did:web+vh')).toBeInTheDocument();
  });

  it('applies correct styling classes', () => {
    const { container } = render(<DidMethodChip method={DidMethod.DID_WEB} />);
    const span = container.firstChild as HTMLElement;
    expect(span.tagName).toBe('SPAN');
    expect(span.className).toContain('text-base');
    expect(span.className).toContain('text-black');
  });
});
