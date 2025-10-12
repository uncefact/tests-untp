import { render, screen } from '@testing-library/react';
import { Credential } from '../components/Credential';
import { MessageText } from '../components/MessageText';

// Mocking MUI components
jest.mock('@mui/material', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Button: ({
    children,
    onClick,
    variant,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={`MuiButton-${variant || 'contained'}`} {...props}>
      {children}
    </button>
  ),
}));

// Mocking the BackButton component and invoking its onNavigate prop
jest.mock('../components/BackButton/BackButton', () => {
  const MockBackButton = ({ onNavigate }: { onNavigate?: () => void }) => {
    if (onNavigate) {
      onNavigate(); // Simulating the onNavigate action
    }
    return <>Go back </>;
  };
  MockBackButton.displayName = 'MockBackButton';
  return MockBackButton;
});

// Mocking the CredentialInfo component
jest.mock('../components/CredentialInfo/CredentialInfo', () => {
  const MockCredentialInfo = () => {
    return <>CredentialInfo </>;
  };
  MockCredentialInfo.displayName = 'MockCredentialInfo';
  return MockCredentialInfo;
});

// Mocking the CredentialTabs component
jest.mock('../components/CredentialTabs/CredentialTabs', () => {
  const MockCredentialTabs = () => {
    return <>CredentialTabs </>;
  };
  MockCredentialTabs.displayName = 'MockCredentialTabs';
  return MockCredentialTabs;
});

// Mocking external components and modules
jest.mock('@mock-app/components', () => ({
  Status: {
    error: 'error',
  },
}));

// Mocking the MessageText component and its Status object
jest.mock('../components/MessageText', () => ({
  MessageText: jest.fn(),
  Status: {
    error: 'error',
  },
}));

// Mocking the Renderer and WebRenderingTemplate2022 components
jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

describe('Credential content', () => {
  afterEach(() => {
    jest.clearAllMocks(); // Clearing all mock calls after each test
  });

  it('should render credential content component', () => {
    (MessageText as jest.MockedFunction<typeof MessageText>).mockImplementation(() => <>MessageText</>); // Mocking the MessageText component implementation

    // Fake data for the credential
    const credential = {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
      type: ['VerifiableCredential'],
      issuer: {
        id: '',
      },
      credentialSubject: {},
      renderMethod: [],
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

    // Rendering the Credential component with the mock credential
    render(<Credential credential={credential} />);

    // Expecting the CredentialInfo component to be rendered
    expect(screen.getByText(/CredentialInfo/i)).not.toBeNull();
  });
});
