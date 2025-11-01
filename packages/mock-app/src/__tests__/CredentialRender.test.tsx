import { render, screen, waitFor, act } from '@testing-library/react';
import { CredentialRender } from '../components/CredentialRender';

// Mocking MUI components
jest.mock('@mui/material', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  CircularProgress: ({ ...props }: { [key: string]: unknown }) => <div {...props}>Loading...</div>,
}));

// Mocking modules from @uncefact/vckit-renderer
jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: class MockRenderer {
    // Mocking the renderCredential method to return a single document with delay
    async renderCredential() {
      // Add a small delay to simulate async operation
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { documents: [{ renderedTemplate: 'base64encodedtemplate' }] };
    }
  },
  WebRenderingTemplate2022: jest.fn(), // Mocking WebRenderingTemplate2022
}));

// Mocking VerifiableCredential from @uncefact/vckit-core-types
jest.mock('@uncefact/vckit-core-types', () => ({
  VerifiableCredential: {}, // Mocking VerifiableCredential to be an empty object
}));

// Mocking the convertBase64ToString utility function from ../utils
jest.mock('../utils', () => ({
  convertBase64ToString: jest.fn(() => '<div>Credential render</div>'), // Mocking the conversion function
}));

describe('Credential render', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress expected console.log errors from verify page
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.clearAllMocks(); // Clearing all mock calls before each test
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  // Fake data for the credential
  const credential = {
    '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
    type: ['VerifiableCredential'],
    issuer: {
      id: '',
    },
    credentialSubject: {},
    renderMethod: [
      {
        template: '<div>Credential render</div>',
        '@type': 'WebRenderingTemplate2022',
      },
    ],
    credentialStatus: {
      id: 'id',
      type: 'RevocationList2020Status',
      revocationListIndex: 6,
      revocationListCredential: 'id',
    },
    issuanceDate: '2023-12-20T03:31:45.547Z',
    proof: {
      type: 'JsonWebSignature2020',
      created: '2023-12-20T03:31:45Z',
    },
  };

  it('should renders loading state initially', () => {
    // Render the CredentialRender component with the mock credential
    render(<CredentialRender credential={credential} />);

    // Expecting the loading indicator to be present in the rendered component initially
    const loadingIndicator = screen.getByTestId('loading-indicator');
    expect(loadingIndicator).toBeInTheDocument();
  });

  // Test case: should renders credential content after loading
  it('should renders credential content after loading', async () => {
    // Render the CredentialRender component with the mock credential
    await act(async () => {
      render(<CredentialRender credential={credential} />);
    });

    // Wait for the component to finish loading
    await waitFor(() => {
      // Expecting the text 'Credential render' to be present in the rendered component
      const templateElement = screen.getByText('Credential render');
      expect(templateElement).toBeInTheDocument();
    });
  });
});
