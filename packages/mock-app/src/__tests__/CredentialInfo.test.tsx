import React from 'react';
import { render, screen } from '@testing-library/react';
import { CredentialInfo } from '../components/CredentialInfo';

// Mocking modules from @vckit/core-types
jest.mock('@vckit/core-types', () => ({
  IssuerType: '' || [], // Mocking IssuerType to be an empty string or an empty array
  VerifiableCredential: {}, // Mocking VerifiableCredential to be an empty object
}));

describe('Credential info content', () => {
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

  it('should render credential info content component', () => {
    // Render the CredentialInfo component with the mock credential
    render(<CredentialInfo credential={credential} />);
    // Expecting the text 'VerifiableCredential' to be present in the rendered component
    expect(screen.getByText('VerifiableCredential')).not.toBeNull();
  });

  it('should show a type different from VerifiableCredential with array type', () => {
    // Creating a new credential object with a different type
    const rewriteCredential = {
      ...credential,
      type: ['VerifiableCredential', 'OtherType'],
    };
    // Render the CredentialInfo component with the modified credential
    render(<CredentialInfo credential={rewriteCredential} />);
    // Expecting the text 'OtherType' to be present in the rendered component
    expect(screen.getByText('OtherType')).not.toBeNull();
  });

  it('should show a type different from VerifiableCredential with string type', () => {
    // Creating a new credential object with a different type
    const rewriteCredential2 = {
      ...credential,
      type: 'OtherType',
    };
    // Render the CredentialInfo component with the modified credential
    render(<CredentialInfo credential={rewriteCredential2} />);
    // Expecting the text 'OtherType' to be present in the rendered component
    expect(screen.getByText('OtherType')).not.toBeNull();
  });

  it('should show an issuer with string type', () => {
    // Creating a new credential object with a string issuer
    const rewriteCredential = {
      ...credential,
      issuer: 'issuer',
    };
    // Render the CredentialInfo component with the modified credential
    render(<CredentialInfo credential={rewriteCredential} />);
    // Expecting the text 'issuer' to be present in the rendered component
    expect(screen.getByText('issuer')).not.toBeNull();
  });
});
