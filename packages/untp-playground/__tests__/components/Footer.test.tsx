/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/Footer';

describe('Footer', () => {
  it('renders correctly', () => {
    render(<Footer />);

    // Test container classes
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveClass('border-t');

    const container = footer.firstElementChild;
    expect(container).toHaveClass('container', 'mx-auto', 'p-8', 'max-w-7xl');
  });

  it('renders all links with correct attributes', () => {
    render(<Footer />);

    // Test UNTP Specification link
    const specLink = screen.getByRole('link', { name: /untp specification/i });
    expect(specLink).toHaveAttribute('href', 'https://uncefact.github.io/spec-untp/');
    expect(specLink).toHaveAttribute('target', '_blank');
    expect(specLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(specLink).toHaveClass('hover:text-foreground', 'transition-colors');

    // Test UNTP Test Suite link
    const testSuiteLink = screen.getByRole('link', { name: /untp test suite/i });
    expect(testSuiteLink).toHaveAttribute('href', 'https://uncefact.github.io/tests-untp/');
    expect(testSuiteLink).toHaveAttribute('target', '_blank');
    expect(testSuiteLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(testSuiteLink).toHaveClass('hover:text-foreground', 'transition-colors');
  });

  it('renders separator dot with correct visibility classes', () => {
    render(<Footer />);

    const separator = screen.getByText('•');
    expect(separator).toHaveClass('hidden', 'md:inline');
  });

  it('has correct responsive layout classes', () => {
    render(<Footer />);

    const linksContainer = screen.getByText('•').parentElement;
    expect(linksContainer).toHaveClass(
      'flex',
      'flex-col',
      'md:flex-row',
      'justify-center',
      'items-center',
      'gap-4',
      'text-sm',
      'text-muted-foreground',
    );
  });

  it('renders links in correct order', () => {
    render(<Footer />);

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('UNTP Specification');
    expect(links[1]).toHaveTextContent('UNTP Test Suite');
  });
});
