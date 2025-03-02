import { SectionHeader } from '@/components/SectionHeader';
import { render, screen } from '@testing-library/react';

describe('SectionHeader', () => {
  it('renders the title correctly', () => {
    render(<SectionHeader title='Test Title' />);
    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('renders children when provided', () => {
    render(
      <SectionHeader title='Test Title'>
        <button>Test Button</button>
      </SectionHeader>,
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
    expect(screen.getByText('Test Button')).toBeInTheDocument();
  });
});
