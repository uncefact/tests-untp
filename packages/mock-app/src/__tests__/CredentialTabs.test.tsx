import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CredentialTabs } from '../components/CredentialTabs';

// Mocking modules from @vckit/renderer
jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(), // Mocking Renderer to be a Jest mock function
  WebRenderingTemplate2022: jest.fn(), // Mocking WebRenderingTemplate2022 to be a Jest mock function
}));

// Mocking the convertBase64ToString utility function from ../utils
jest.mock('../utils', () => ({
  convertBase64ToString: jest.fn().mockImplementation(() => '<div>Credential render</div>'), // Mocking the conversion function
}));

// Mocking the CredentialRender component
jest.mock('../components/CredentialRender/CredentialRender', () => () => <>CredentialRender</>);
// Mocking the JsonBlock component
jest.mock('../components/JsonBlock/JsonBlock', () => () => <>JsonBlock</>);

describe('Credential tabs content', () => {
  afterEach(() => {
    jest.clearAllMocks(); // Clearing all mock calls after each test
  });

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

  it('should render credential tabs component', () => {
    // Render the CredentialTabs component with the mock credential
    render(<CredentialTabs credential={credential} />);
    // Expecting the text 'JsonBlock' to be present in the rendered component
    expect(screen.getByText('JsonBlock')).not.toBeNull();
  });

  it('should render only json tab', () => {
    // Creating a new credential object with a rendering template
    const credential2 = {
      ...credential,
      render: [
        {
          template: '<div>Credential render</div>',
          '@type': 'WebRenderingTemplate2022',
        },
      ],
    };
    // Render the CredentialTabs component with the modified credential
    render(<CredentialTabs credential={credential2} />);
    // Expecting the text 'CredentialRender' to be present in the rendered component
    expect(screen.getByText('CredentialRender')).not.toBeNull();
  });

  it('should display on change value', () => {
    // Render the CredentialTabs component with the mock credential
    render(<CredentialTabs credential={credential} />);
    // Find the tab with role 'tab' and name 'Rendered', simulate a click event on it
    const tab = screen.getByRole('tab', { name: 'Rendered' });
    fireEvent.click(tab);
    // Expecting the tab with 'selected' attribute to have accessible name 'Rendered'
    expect(screen.getByRole('tab', { selected: true })).toHaveAccessibleName('Rendered');
  });

  it('should display download button', () => {
    // Mocking the URL.createObjectURL function
    const mockCreateObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;

    // Render component with the mock credential
    render(<CredentialTabs credential={credential} />);

    // Find the button with text 'Download', simulate a click event on it
    const button = screen.getByText(/Download/i);
    button.click();

    // Expecting the button with text 'Download' to be present in the rendered component
    expect(screen.getByText(/Download/i)).not.toBeNull();
    // Expecting the URL.createObjectURL function to have been called
    expect(mockCreateObjectURL).toHaveBeenCalled();
    // Restore the original URL.createObjectURL to avoid side effects on other tests
    global.URL.createObjectURL = mockCreateObjectURL;
  });
});
