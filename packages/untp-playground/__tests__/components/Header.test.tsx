/**
 * @jest-environment jsdom
 */

import { Header } from '@/components/Header';
import { render, screen } from '@testing-library/react';
import { testSuiteVersion } from '../../config';

describe('Header', () => {
  it('renders correctly', () => {
    render(<Header />);

    // Test container element
    const header = screen.getByRole('banner');
    expect(header).toHaveClass('border-b');
  });

  it('has correct container classes', () => {
    render(<Header />);

    const container = screen.getByRole('banner').firstElementChild;
    expect(container).toHaveClass('container', 'mx-auto', 'p-8', 'max-w-7xl', 'flex', 'items-center', 'gap-4');
  });

  it('renders the title correctly', () => {
    render(<Header />);

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('UNTP Playground');
    expect(heading).toHaveClass('text-2xl', 'font-bold');
  });

  it('renders the header with correct title and version', () => {
    render(<Header />);

    expect(screen.getByText('UNTP Playground')).toBeInTheDocument();
    expect(screen.getByText(`v${testSuiteVersion}`)).toBeInTheDocument();
  });

  // If we uncomment the Image component in the future
  // it('renders the logo image when enabled', () => {
  //   render(<Header />);
  //
  //   const logo = screen.getByAltText('UNTP Logo');
  //   expect(logo).toBeInTheDocument();
  //
});
