import { EmptyState } from '@/components/EmptyState';
import { render, screen } from '@testing-library/react';

describe('EmptyState', () => {
  it('renders the title and guidance', () => {
    render(<EmptyState title='No credentials yet' guidance='Add a credential from the panel on the right.' />);

    expect(screen.getByText('No credentials yet')).toBeInTheDocument();
    expect(screen.getByText('Add a credential from the panel on the right.')).toBeInTheDocument();
  });

  it('renders the icon when one is provided', () => {
    render(<EmptyState icon={<span data-testid='empty-icon' />} title='No credentials yet' guidance='Add one.' />);

    expect(screen.getByTestId('empty-icon')).toBeInTheDocument();
  });

  it('omits the icon when none is provided', () => {
    render(<EmptyState title='No credentials yet' guidance='Add one.' />);

    expect(screen.queryByTestId('empty-icon')).not.toBeInTheDocument();
  });
});
