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

  it('should render json block content component', () => {
    // Render the JsonBlock component with the mock credential
    render(<JsonBlock credential={credential} />);
    // Expecting the text 'VerifiableCredential' to be present in the rendered component
    expect(screen.getByText(/VerifiableCredential/i)).not.toBeNull();
  });
});
