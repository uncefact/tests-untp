import { act, render, screen, waitFor } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Router as RouterDom } from 'react-router-dom';
import { Verify } from '../pages';
import { privateAPI, publicAPI } from '@mock-app/services';
import { VerifiableCredential } from '@vckit/core-types';

console.error = jest.fn();
jest.mock('@mock-app/components', () => ({
  Status: 'success',
  toastMessage: jest.fn(),
  ToastMessage: jest.fn(),
}));
jest.mock('@mock-app/services', () => ({
  getDlrPassport: jest.fn(),
  IdentityProvider: jest.fn(),
  getProviderByType: jest.fn(),
  publicAPI: { get: jest.fn() },
  privateAPI: { post: jest.fn(), setBearerTokenAuthorizationHeaders: jest.fn() },
}));
jest.mock('@veramo/utils', () => ({
  computeEntryHash: jest.fn(),
}));
jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));
jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: () => ({
    // Mock the search query string
    search:
      'q=%7B"payload"%3A%7B"uri"%3A"http%3A%2F%2Flocalhost%3A3333%2Fv1%2Fverifiable-credentials%2Fd1fc233a-0e32-4c36-8131-2be5fef7a243.json"%7D%7D',
  }),
}));
jest.mock(
  '../components/CredentialTabs/CredentialTabs',
  () =>
    ({ credential }: { credential: VerifiableCredential }) => {
      const name = credential.credentialSubject?.name;
      const renderTemplate = credential.render.template;
      // Simulate the rendering of the credential with the name
      const rendered = renderTemplate.replace('{{name}}', name);
      return <div dangerouslySetInnerHTML={{ __html: rendered }} />;
    },
);

describe('Verify', () => {
  const mockEncryptedCredential = {
    credentialStatus: {
      id: 'http://example.com/bitstring-status-list/1#0',
      type: 'BitstringStatusListEntry',
      statusPurpose: 'revocation',
      statusListIndex: 0,
      statusListCredential: 'http://example.com/bitstring-status-list/1',
    },
    render: { template: '<h1>{{name}}</h1>' },
    type: ['VerifiableCredential'],
    credentialSubject: { name: 'John Doe' },
  };
  const history = createMemoryHistory({ initialEntries: ['/verify'] });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading screen', async () => {
    render(
      <RouterDom location={history.location} navigator={history}>
        <Verify />
      </RouterDom>,
    );

    expect(screen.getByText('Fetching the credential')).toBeInTheDocument();
  });

  it('should render error screen', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce({});

    await act(async () => {
      render(
        <RouterDom location={history.location} navigator={history}>
          <Verify />
        </RouterDom>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
  });

  it('should render failure screen due to no matching proofs', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request failing due to the revoked status.
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({
      verified: false,
      error: {
        message: 'No matching proofs found in the given document.',
      },
    });

    await act(async () => {
      render(
        <RouterDom location={history.location} navigator={history}>
          <Verify />
        </RouterDom>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('No matching proofs found in the given document.')).toBeInTheDocument();
    });
  });

  it('should render failure screen for revoked credential', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request failing due to the revoked status.
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({
      verified: false,
      error: {
        message: 'revoked: The credential was revoked by the issuer',
      },
    });

    await act(async () => {
      render(
        <RouterDom location={history.location} navigator={history}>
          <Verify />
        </RouterDom>,
      );
    });

    await waitFor(() => {
      expect(screen.getByText('revoked: The credential was revoked by the issuer')).toBeInTheDocument();
    });
  });

  it('should render success screen for active credential', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request succeeding due to the active status.
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({ verified: true });

    await act(async () => {
      render(
        <RouterDom location={history.location} navigator={history}>
          <Verify />
        </RouterDom>,
      );
    });

    await waitFor(() => {
      // Expect the rendered credential: <h1>John Doe</h1> for render template '<h1>{{name}}</h1>'
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen when VC lacks credential status', async () => {
    // Remove the credential status from the mock encrypted credential
    const { credentialStatus, ...mockEncryptedCredentialWithoutStatus } = mockEncryptedCredential;
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredentialWithoutStatus);
    // Simulate the response of a verify VC request succeeding without a credential status.
    jest.spyOn(privateAPI, 'post').mockResolvedValueOnce({ verified: true });

    await act(async () => {
      render(
        <RouterDom location={history.location} navigator={history}>
          <Verify />
        </RouterDom>,
      );
    });

    await waitFor(() => {
      // Expect the rendered credential: <h1>John Doe</h1>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });
});
