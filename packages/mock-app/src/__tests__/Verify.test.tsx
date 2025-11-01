import * as jose from 'jose';
import { act, render, screen, waitFor } from '@testing-library/react';
import { UnsignedCredential, VerifiableCredential } from '@uncefact/vckit-core-types';
import { computeHash, decryptCredential, publicAPI, verifyVC } from '@mock-app/services';
import Verify from '../app/(public)/verify/page';

console.error = jest.fn();
console.log = jest.fn();

// Mock Next.js navigation
const mockUseSearchParams = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => mockUseSearchParams(),
}));

// Mock BackButton component
jest.mock('@/components/BackButton', () => ({
  BackButton: ({ children }: { children: React.ReactNode }) => <div data-testid='back-button'>{children}</div>,
}));

// Mock Credential component
jest.mock('@/components/Credential/Credential', () => ({
  __esModule: true,
  default: ({
    credential,
    decodedEnvelopedVC,
  }: {
    credential: VerifiableCredential;
    decodedEnvelopedVC?: UnsignedCredential;
  }) => {
    const name = decodedEnvelopedVC?.credentialSubject?.name ?? credential?.credentialSubject?.name;
    const renderTemplate = decodedEnvelopedVC?.renderMethod?.template ?? credential?.renderMethod?.template ?? '';
    // Simulate the rendering of the credential with the name
    const rendered = renderTemplate.replace('{{name}}', name);
    return <div dangerouslySetInnerHTML={{ __html: rendered }} />;
  },
}));

// Mock LoadingWithText component
jest.mock('@/components/LoadingWithText', () => ({
  LoadingWithText: ({ text }: { text: string }) => <div>{text}</div>,
}));

// Mock MessageText component
jest.mock('@/components/MessageText', () => ({
  MessageText: ({ text }: { text: string }) => <div>{text}</div>,
}));

// Mock app config
jest.mock('@/constants/app-config.json', () => ({
  defaultVerificationServiceLink: {
    href: 'http://localhost:3332/agent/routeVerificationCredential',
    headers: {},
  },
}));

jest.mock('@mock-app/components', () => ({
  Status: 'success',
  toastMessage: jest.fn(),
  ToastMessage: jest.fn(),
}));
jest.mock('@mock-app/services', () => ({
  getDlrPassport: jest.fn(),
  IdentityProvider: jest.fn(),
  getProviderByType: jest.fn(),
  decryptCredential: jest.fn(),
  computeHash: jest.fn(),
  verifyVC: jest.fn(),
  publicAPI: { get: jest.fn() },
  privateAPI: { post: jest.fn(), setBearerTokenAuthorizationHeaders: jest.fn() },
}));

jest.mock('jose', () => ({
  decodeJwt: jest.fn(),
}));
jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

// Set default mock for useSearchParams
mockUseSearchParams.mockReturnValue(
  new URLSearchParams(
    'q=%7B"payload"%3A%7B"uri"%3A"http%3A%2F%2Flocalhost%3A3333%2Fv1%2Fverifiable-credentials%2Fd1fc233a-0e32-4c36-8131-2be5fef7a243.json"%7D%7D',
  ),
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
    renderMethod: { template: '<h1>{{name}}</h1>', type: 'WebRenderingTemplate2022' },
    type: ['VerifiableCredential'],
    credentialSubject: { name: 'John Doe' },
    context: [
      {
        ex: 'https://www.w3.org/2018/credentials#renderMethod#',
        renderMethod: 'https://www.w3.org/2018/credentials#renderMethod',
        template: 'ex:template',
        url: 'ex:url',
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should render loading screen', async () => {
    render(<Verify />);

    expect(screen.getByText('Fetching the credential')).toBeInTheDocument();
  });

  it('should render error screen', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce({});

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByText('Something went wrong. Please try again.')).toBeInTheDocument();
    });
  });

  it('should render failure screen due to no matching proofs', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request failing due to no matching proofs.
    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: false,
      error: {
        message: 'No matching proofs found in the given document.',
      },
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByText('No matching proofs found in the given document.')).toBeInTheDocument();
    });
  });

  it('should render failure screen for revoked credential', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request failing due to the revoked status.

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: false,
      error: {
        message: 'revoked: The credential was revoked by the issuer',
      },
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByText('revoked: The credential was revoked by the issuer')).toBeInTheDocument();
    });
  });

  it('should render success screen for active credential without hash', async () => {
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);
    // Simulate the response of a verify VC request succeeding due to the active status.
    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
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
    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      // Expect the rendered credential: <h1>John Doe</h1> for render template '<h1>{{name}}</h1>'
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen for valid payload with hash and lds proof without key', async () => {
    const mockPayloadValidHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        hash: 'c60a35053e0d9f64e2072ad1d995182169dc05eaeded065b128e006681149ba3',
      },
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadValidHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);

    (computeHash as jest.Mock).mockImplementation(() => mockPayloadValidHash.payload.hash);

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen for valid hash and enveloping proof without key', async () => {
    const mockPayloadValidHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        hash: '595d8d20c586c6f55f8a758f294674fa85069db5c518a0f4cbbd3fd61f46522f',
      },
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadValidHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    const mockCredentialEnvelopingProof = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/dpp/0.5.0/'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJIUzI1NiIsImlzcyI6ImRpZDp3ZWI6dW5jZWZhY3QuZ2l0aHViLmlvOnByb2plY3QtdmNraXQ6dGVzdC1hbmQtZGV2ZWxvcG1lbnQiLCJ0eXAiOiJ2Yy1sZCtqd3QifQ.eyJjcmVkZW50aWFsU3RhdHVzIjp7ImlkIjoiaHR0cDovL2V4YW1wbGUuY29tL2JpdHN0cmluZy1zdGF0dXMtbGlzdC8xIzAiLCJ0eXBlIjoiQml0c3RyaW5nU3RhdHVzTGlzdEVudHJ5Iiwic3RhdHVzUHVycG9zZSI6InJldm9jYXRpb24iLCJzdGF0dXNMaXN0SW5kZXgiOjAsInN0YXR1c0xpc3RDcmVkZW50aWFsIjoiaHR0cDovL2V4YW1wbGUuY29tL2JpdHN0cmluZy1zdGF0dXMtbGlzdC8xIn0sInJlbmRlciI6eyJ0ZW1wbGF0ZSI6IjxoMT57e25hbWV9fTwvaDE-In0sInR5cGUiOlsiVmVyaWZpYWJsZUNyZWRlbnRpYWwiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsibmFtZSI6IkpvaG4gRG9lIn19.cn7DawmWIcyONNqMNMQrDISUMQjEmT7SqRn8kG1aAMk',
    };
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockCredentialEnvelopingProof);

    (computeHash as jest.Mock).mockImplementation(() => mockPayloadValidHash.payload.hash);

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    (jose.decodeJwt as jest.Mock).mockImplementation(() => ({
      ...mockEncryptedCredential,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen for valid hash and enveloping proof with key', async () => {
    const mockPayloadValidHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        hash: '595d8d20c586c6f55f8a758f294674fa85069db5c518a0f4cbbd3fd61f46522f',
        key: 'key',
      },
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadValidHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    const mockNewEncryptedCredential = {
      cipherText:
        'LGoWS4IlsMnp4OrMZ1Pm85hAS+y6iQ2kj3j0ZSQzpB8De30T/1IbQr42XPlUZSxqP2El9qBFvRz9sk0yQ4jGTw8jLKLEv9ZGu3svfj/oAygVB8hexOLQc6fHq0Jw5h+zXTNye6syOfaq7+jxGOJC3xBjOuqfqprnw6Idli6GAJ/LOdj+/C/OZoEMNvEEH+l51MWWBz2m3J5RxvfeNnaqfKylfYquf0Ajk/Eba6QtVFGrMcgY6kkgQu4FCkWMHwS89vDy4guEzecYQYXn4WtCJc0lnIMwYzIbVs9Sm03lIwk60nKyt1XU1Cu8tQyjGjOl6RiODsNjq1yNXFxUXwf75wAcwdY0qpsFD79MWyPHnOQApQxvwJx3a4exjSV+36y4Zjtv/6lu9Epq25+kEwdlevRSYU5KYg7tMhG7sDtyOvHJ9WksBX6O5OuZ1rzP89l/+0vDagdeiF4XbtAo9CcdfeRvxPzEaw7X55DdpVzv9YVYuMSi/IKxa3XLbkmR2eBIUz/ZdxpXXoMmnovSs4tHAwJzu3U5KMf2/dfjCpFbOwUZQ/j+RNlDFeQMuQzW8Xd2l3IfAHev0SXR5td1hvC1RbNj4loQHWugdbwMXf7AG7DhEmK7F3u0deNyuPlayqRUkxC8sWTiWlzJz9vM0KEb4dB9giGkPdtXgLqk3paiGk4Tqa9218yaP9E+wF0lcu0NElcR3nlW2aEsPFFQddbuD8jRHPDThCeH20+9mfNL3FcyllviK4dBjysWURc0tXeAWoloxwcphqIgjyDn3xZHJAfPKfIz+i8q3vgp15eAYs3fIV+GUp4r3bAk4qoIVx0cOn/Oea2XXwsp3zdNk3V+1rDKZdGmXFwQBCbutXOBrOpgZMaNgMVL9iq4umVIRZAXhG1mW9reLycqUMdoxIVvjqWbc5F+7uAUHwZCNBpmuLFVuK/hJbFBMb7/aDCA4P+9PUGEYAAfo8ZDrg5uRLX0vcAeYqB0WlgAdAH7/Tw8mSbyMoV8U7oNf5BNrpHvgAqGQjLmF9884nt6vRK0/p3BWV0ClLWND5DTQUfdTHqDIBnp1ZnlWGIZinhzNTg=',
      iv: 'qeMaTopj5mExcu4/',
      tag: 'ARRrKWEDQVZrSh1w0+L7VA==',
      type: 'aes-256-gcm',
    };
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockNewEncryptedCredential);

    (computeHash as jest.Mock).mockImplementation(() => mockPayloadValidHash.payload.hash);

    (decryptCredential as jest.Mock).mockImplementation(() => JSON.stringify(mockEncryptedCredential));

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen for valid enveloping proof without hash and key', async () => {
    const mockPayloadWithoutHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
      },
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadWithoutHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    const mockCredentialEnvelopingProof = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://vocabulary.uncefact.org/untp/dpp/0.5.0/'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,eyJhbGciOiJIUzI1NiIsImlzcyI6ImRpZDp3ZWI6dW5jZWZhY3QuZ2l0aHViLmlvOnByb2plY3QtdmNraXQ6dGVzdC1hbmQtZGV2ZWxvcG1lbnQiLCJ0eXAiOiJ2Yy1sZCtqd3QifQ.eyJjcmVkZW50aWFsU3RhdHVzIjp7ImlkIjoiaHR0cDovL2V4YW1wbGUuY29tL2JpdHN0cmluZy1zdGF0dXMtbGlzdC8xIzAiLCJ0eXBlIjoiQml0c3RyaW5nU3RhdHVzTGlzdEVudHJ5Iiwic3RhdHVzUHVycG9zZSI6InJldm9jYXRpb24iLCJzdGF0dXNMaXN0SW5kZXgiOjAsInN0YXR1c0xpc3RDcmVkZW50aWFsIjoiaHR0cDovL2V4YW1wbGUuY29tL2JpdHN0cmluZy1zdGF0dXMtbGlzdC8xIn0sInJlbmRlciI6eyJ0ZW1wbGF0ZSI6IjxoMT57e25hbWV9fTwvaDE-In0sInR5cGUiOlsiVmVyaWZpYWJsZUNyZWRlbnRpYWwiXSwiY3JlZGVudGlhbFN1YmplY3QiOnsibmFtZSI6IkpvaG4gRG9lIn19.cn7DawmWIcyONNqMNMQrDISUMQjEmT7SqRn8kG1aAMk',
    };
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockCredentialEnvelopingProof);

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    (jose.decodeJwt as jest.Mock).mockImplementation(() => ({
      ...mockEncryptedCredential,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should render success screen for valid enveloping proof and key without hash', async () => {
    const mockPayloadWithoutHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        key: 'key',
      },
    };

    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadWithoutHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    const mockNewEncryptedCredential = {
      cipherText:
        'LGoWS4IlsMnp4OrMZ1Pm85hAS+y6iQ2kj3j0ZSQzpB8De30T/1IbQr42XPlUZSxqP2El9qBFvRz9sk0yQ4jGTw8jLKLEv9ZGu3svfj/oAygVB8hexOLQc6fHq0Jw5h+zXTNye6syOfaq7+jxGOJC3xBjOuqfqprnw6Idli6GAJ/LOdj+/C/OZoEMNvEEH+l51MWWBz2m3J5RxvfeNnaqfKylfYquf0Ajk/Eba6QtVFGrMcgY6kkgQu4FCkWMHwS89vDy4guEzecYQYXn4WtCJc0lnIMwYzIbVs9Sm03lIwk60nKyt1XU1Cu8tQyjGjOl6RiODsNjq1yNXFxUXwf75wAcwdY0qpsFD79MWyPHnOQApQxvwJx3a4exjSV+36y4Zjtv/6lu9Epq25+kEwdlevRSYU5KYg7tMhG7sDtyOvHJ9WksBX6O5OuZ1rzP89l/+0vDagdeiF4XbtAo9CcdfeRvxPzEaw7X55DdpVzv9YVYuMSi/IKxa3XLbkmR2eBIUz/ZdxpXXoMmnovSs4tHAwJzu3U5KMf2/dfjCpFbOwUZQ/j+RNlDFeQMuQzW8Xd2l3IfAHev0SXR5td1hvC1RbNj4loQHWugdbwMXf7AG7DhEmK7F3u0deNyuPlayqRUkxC8sWTiWlzJz9vM0KEb4dB9giGkPdtXgLqk3paiGk4Tqa9218yaP9E+wF0lcu0NElcR3nlW2aEsPFFQddbuD8jRHPDThCeH20+9mfNL3FcyllviK4dBjysWURc0tXeAWoloxwcphqIgjyDn3xZHJAfPKfIz+i8q3vgp15eAYs3fIV+GUp4r3bAk4qoIVx0cOn/Oea2XXwsp3zdNk3V+1rDKZdGmXFwQBCbutXOBrOpgZMaNgMVL9iq4umVIRZAXhG1mW9reLycqUMdoxIVvjqWbc5F+7uAUHwZCNBpmuLFVuK/hJbFBMb7/aDCA4P+9PUGEYAAfo8ZDrg5uRLX0vcAeYqB0WlgAdAH7/Tw8mSbyMoV8U7oNf5BNrpHvgAqGQjLmF9884nt6vRK0/p3BWV0ClLWND5DTQUfdTHqDIBnp1ZnlWGIZinhzNTg=',
      iv: 'qeMaTopj5mExcu4/',
      tag: 'ARRrKWEDQVZrSh1w0+L7VA==',
      type: 'aes-256-gcm',
    };
    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockNewEncryptedCredential);

    (decryptCredential as jest.Mock).mockImplementation(() => JSON.stringify(mockEncryptedCredential));
    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('John Doe');
    });
  });

  it('should show error screen when payload lacks key and hash is invalid', async () => {
    const mockPayloadInvalidHash = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        hash: 'invalid-hash',
      },
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadInvalidHash))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);

    (computeHash as jest.Mock).mockImplementation(() => 'valid-hash');

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to compare the hash in the verify URL with the VC hash.')).toBeInTheDocument();
    });
  });

  it('should show error screen when the key is invalid', async () => {
    const mockPayloadInvalidKey = {
      payload: {
        uri: 'http://localhost:3334/v1/verifiable-credentials/6c70251a-f2e7-48a0-a86c-e1027f0e7143.json',
        hash: '595d8d20c586c6f55f8a758f294674fa85069db5c518a0f4cbbd3fd61f46522f',
        key: 'invalid-key',
      },
    };
    const mockEncryptedCredential = {
      cipherText: '+qygK55Jq2S/VmhI8xxHr6JQZbZpM2UbwwPtXgYAh6Opn8Re0y+VStefzXgk3KVRYeaZd+/WZv/Nm3XXdxouGqk2toWHZtAnYAW',
      iv: 'HMFLTHEabOowe0pj',
      tag: '0B6Js19du2TJ0ADdYe2Ipw==',
      type: 'aes-256-gcm',
    };
    // URL-encode the payload for use as a query parameter
    const encodedPayload = `q=${encodeURIComponent(JSON.stringify(mockPayloadInvalidKey))}`;
    mockUseSearchParams.mockReturnValue(new URLSearchParams(encodedPayload));

    jest.spyOn(publicAPI, 'get').mockResolvedValueOnce(mockEncryptedCredential);

    (computeHash as jest.Mock).mockImplementation(() => mockPayloadInvalidKey.payload.hash);
    (decryptCredential as jest.Mock).mockImplementation(() => {
      throw new Error('Failed to decrypt credential');
    });

    (verifyVC as jest.Mock).mockImplementation(() => ({
      verified: true,
    }));

    await act(async () => {
      render(<Verify />);
    });

    await waitFor(() => {
      expect(screen.getByText('Failed to decrypt credential.')).toBeInTheDocument();
    });
  });
});
