/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { RuntimeConfigProvider, useRuntimeConfig, defaultConfig } from '@/contexts/RuntimeConfigContext';

function ConfigConsumer() {
  const config = useRuntimeConfig();
  return (
    <>
      <span data-testid='headerTitle'>{config.headerTitle}</span>
      <span data-testid='specUrl'>{config.specUrl}</span>
      <span data-testid='testSuiteUrl'>{config.testSuiteUrl}</span>
    </>
  );
}

describe('RuntimeConfigContext', () => {
  it('provides default config values', () => {
    render(
      <RuntimeConfigProvider config={defaultConfig}>
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('headerTitle')).toHaveTextContent('UNTP Playground');
    expect(screen.getByTestId('specUrl')).toHaveTextContent('https://untp.unece.org');
    expect(screen.getByTestId('testSuiteUrl')).toHaveTextContent('https://github.com/uncefact/tests-untp');
  });

  it('provides custom config values', () => {
    render(
      <RuntimeConfigProvider
        config={{
          headerTitle: 'Custom App',
          specUrl: 'https://custom-spec.example.com',
          testSuiteUrl: 'https://custom-tests.example.com',
        }}
      >
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('headerTitle')).toHaveTextContent('Custom App');
    expect(screen.getByTestId('specUrl')).toHaveTextContent('https://custom-spec.example.com');
    expect(screen.getByTestId('testSuiteUrl')).toHaveTextContent('https://custom-tests.example.com');
  });
});
