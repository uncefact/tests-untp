import React from 'react';
import { render, screen } from '@testing-library/react';
import { Credential } from '../components/Credential';
import { MessageText } from '../components/MessageText';

// Mocking the BackButton component and invoking its onNavigate prop
jest.mock('../components/BackButton/BackButton', () => ({ onNavigate }: any) => {
  onNavigate(); // Simulating the onNavigate action
  return <>Go back </>;
});

// Mocking the CredentialInfo component
jest.mock('../components/CredentialInfo/CredentialInfo', () => () => {
  return <>CredentialInfo </>;
});

// Mocking the CredentialTabs component
jest.mock('../components/CredentialTabs/CredentialTabs', () => () => {
  return <>CredentialTabs </>;
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
jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

describe('Credential content', () => {
  afterEach(() => {
    jest.clearAllMocks(); // Clearing all mock calls after each test
  });

  it('should render credential content component', () => {
    (MessageText as any).mockImplementation(() => <>MessageText</>); // Mocking the MessageText component implementation

    // Fake data for the credential
    const credential = {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://w3id.org/vc-revocation-list-2020/v1'],
      type: ['VerifiableCredential'],
      issuer: {
        id: '',
      },
      credentialSubject: {},
      render: [],
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
