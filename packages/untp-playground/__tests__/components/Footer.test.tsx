/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { Footer } from '@/components/Footer';
import { RuntimeConfigProvider, defaultConfig } from '@/contexts/RuntimeConfigContext';

function renderFooter(config = defaultConfig) {
  return render(
    <RuntimeConfigProvider config={config}>
      <Footer />
    </RuntimeConfigProvider>,
  );
}

describe('Footer', () => {
  it('renders correctly', () => {
    renderFooter();

    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveClass('border-t');

    const container = footer.firstElementChild;
    expect(container).toHaveClass('container', 'mx-auto', 'p-8', 'max-w-7xl');
  });

  it('renders all links with default URLs', () => {
    renderFooter();

    const specLink = screen.getByRole('link', { name: /untp specification/i });
    expect(specLink).toHaveAttribute('href', 'https://untp.unece.org');
    expect(specLink).toHaveAttribute('target', '_blank');
    expect(specLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(specLink).toHaveClass('hover:text-foreground', 'transition-colors');

    const testSuiteLink = screen.getByRole('link', { name: /untp test suite/i });
    expect(testSuiteLink).toHaveAttribute('href', 'https://github.com/uncefact/tests-untp');
    expect(testSuiteLink).toHaveAttribute('target', '_blank');
    expect(testSuiteLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(testSuiteLink).toHaveClass('hover:text-foreground', 'transition-colors');
  });

  it('renders custom URLs from runtime config', () => {
    renderFooter({
      ...defaultConfig,
      specUrl: 'https://custom-spec.example.com',
      testSuiteUrl: 'https://custom-tests.example.com',
    });

    const specLink = screen.getByRole('link', { name: /untp specification/i });
    expect(specLink).toHaveAttribute('href', 'https://custom-spec.example.com');

    const testSuiteLink = screen.getByRole('link', { name: /untp test suite/i });
    expect(testSuiteLink).toHaveAttribute('href', 'https://custom-tests.example.com');
  });

  it('renders separator dot with correct visibility classes', () => {
    renderFooter();

    const separator = screen.getByText('•');
    expect(separator).toHaveClass('hidden', 'md:inline');
  });

  it('has correct responsive layout classes', () => {
    renderFooter();

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
    renderFooter();

    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveTextContent('UNTP Specification');
    expect(links[1]).toHaveTextContent('UNTP Test Suite');
  });
});
