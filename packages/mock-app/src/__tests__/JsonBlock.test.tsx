import React from 'react';
import { render, screen } from '@testing-library/react';
import { JsonBlock } from '../components/JsonBlock';

// Mocking VerifiableCredential from @vckit/core-types
jest.mock('@vckit/core-types', () => ({
  VerifiableCredential: {}, // Mocking VerifiableCredential to be an empty object
}));

describe('Json block content', () => {
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

  it('should render json block content component', () => {
    // Render the JsonBlock component with the mock credential
    render(<JsonBlock credential={credential} />);
    // Expecting the text 'VerifiableCredential' to be present in the rendered component
    expect(screen.getByText(/VerifiableCredential/i)).not.toBeNull();
  });

  it('should download credential when click on button Download', () => {
    // Mocking the URL.createObjectURL function
    const mockCreateObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;

    // Render the JsonBlock component with the mock credential
    render(<JsonBlock credential={credential} />);
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
