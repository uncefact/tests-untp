/**
 * @jest-environment jsdom
 */

import { render, screen } from '@testing-library/react';
import { RuntimeConfigProvider, useRuntimeConfig, defaultConfig } from '@/contexts/RuntimeConfigContext';

function ConfigConsumer() {
  const config = useRuntimeConfig();
  return (
    <div>
      <span data-testid="headerTitle">{config.headerTitle}</span>
      <span data-testid="verificationServiceUrl">{config.verificationServiceUrl}</span>
      <span data-testid="verificationServiceToken">{config.verificationServiceToken}</span>
    </div>
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
    expect(screen.getByTestId('verificationServiceUrl')).toHaveTextContent(
      'https://vckit.untp.showthething.com/agent/routeVerificationCredential',
    );
    expect(screen.getByTestId('verificationServiceToken')).toHaveTextContent('test123');
  });

  it('provides custom config values', () => {
    const customConfig = {
      headerTitle: 'Custom App',
      verificationServiceUrl: 'https://custom.example.com/verify',
      verificationServiceToken: 'custom-token',
    };

    render(
      <RuntimeConfigProvider config={customConfig}>
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );

    expect(screen.getByTestId('headerTitle')).toHaveTextContent('Custom App');
    expect(screen.getByTestId('verificationServiceUrl')).toHaveTextContent('https://custom.example.com/verify');
    expect(screen.getByTestId('verificationServiceToken')).toHaveTextContent('custom-token');
  });
});
