/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { RuntimeConfigProvider, useRuntimeConfig, defaultConfig } from '@/contexts/RuntimeConfigContext';

function ConfigConsumer() {
  const config = useRuntimeConfig();
  return <span data-testid='headerTitle'>{config.headerTitle}</span>;
}

describe('RuntimeConfigContext', () => {
  it('provides default config values', () => {
    render(
      <RuntimeConfigProvider config={defaultConfig}>
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('headerTitle')).toHaveTextContent('UNTP Playground');
  });

  it('provides custom config values', () => {
    render(
      <RuntimeConfigProvider config={{ headerTitle: 'Custom App' }}>
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );
    expect(screen.getByTestId('headerTitle')).toHaveTextContent('Custom App');
  });
});
