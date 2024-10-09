import { render, screen } from '@testing-library/react';
import { JsonBlock } from '../components/JsonBlock';
import { VerifyPageContext } from '../hooks/VerifyPageContext';

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

  const renderComponent = (verifiableCredential: any) => {
    return render(
      <VerifyPageContext.Provider value={{ vc: verifiableCredential }}>
        <JsonBlock credential={credential} />
      </VerifyPageContext.Provider>,
    );
  };

  it('should render json block content component', () => {
    // Render the JsonBlock component with the mock credential
    renderComponent(credential);
    // Expecting the text 'VerifiableCredential' to be present in the rendered component
    expect(screen.getByText(/VerifiableCredential/i)).not.toBeNull();
  });

  it('should download credential when click on button Download', () => {
    // Mocking the URL.createObjectURL function
    const mockCreateObjectURL = jest.fn();
    global.URL.createObjectURL = mockCreateObjectURL;

    // Render the JsonBlock component with the mock credential
    renderComponent(credential);
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

  it('renders the Download button for a JSON credential', () => {
    renderComponent(credential);
    const downloadButton = screen.getByText('Download');
    expect(downloadButton).toBeInTheDocument();
  });

  it('renders the Download JWT button for a JWT string', () => {
    renderComponent({
      verifiableCredential: {
        type: ['EnvelopedVerifiableCredential'],
        '@context': ['https://www.w3.org/2018/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
        id: 'data:application/vc-ld+jwt,eyJhbGciOiJFZERTQSIsImlzcyI6ImRpZDp3ZWI6ZDVmNi0xMTYtMTA2LTE5Mi0yMTUubmdyb2stZnJlZS5hcHAiLCJ0eXAiOiJ2Yy1sZCtqd3QifQ.eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvdjIiLCJodHRwczovL3d3dy53My5vcmcvbnMvY3JlZGVudGlhbHMvZXhhbXBsZXMvdjIiLCJodHRwczovL2Rldi1yZW5kZXItbWV0aG9kLWNvbnRleHQuczMuYXAtc291dGhlYXN0LTEuYW1hem9uYXdzLmNvbS9kZXYtcmVuZGVyLW1ldGhvZC1jb250ZXh0Lmpzb24iXSwiaWQiOiJodHRwOi8vdW5pdmVyc2l0eS5leGFtcGxlL2NyZWRlbnRpYWxzLzE4NzIiLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIiwiRXhhbXBsZUFsdW1uaUNyZWRlbnRpYWwiXSwiaXNzdWVyIjoiZGlkOndlYjpkNWY2LTExNi0xMDYtMTkyLTIxNS5uZ3Jvay1mcmVlLmFwcCIsInZhbGlkRnJvbSI6IjIwMTAtMDEtMDFUMTk6MjM6MjRaIiwiY3JlZGVudGlhbFNjaGVtYSI6eyJpZCI6Imh0dHBzOi8vZXhhbXBsZS5vcmcvZXhhbXBsZXMvZGVncmVlLmpzb24iLCJ0eXBlIjoiSnNvblNjaGVtYSJ9LCJjcmVkZW50aWFsU3ViamVjdCI6eyJpZCI6ImRpZDpleGFtcGxlOjEyMyIsImRlZ3JlZSI6eyJ0eXBlIjoiQmFjaGVsb3JEZWdyZWUiLCJuYW1lIjoiQmFjaGVsb3Igb2YgU2NpZW5jZSBhbmQgQXJ0cyJ9fSwicmVuZGVyIjpbeyJ0ZW1wbGF0ZSI6IlBHUnBkaUJ6ZEhsc1pUMGlkMmxrZEdnNk16QXdjSGc3SUdobGFXZG9kRG94TURCd2VEc2dZbTl5WkdWeU9pQXljSGdnYzI5c2FXUWdZbXhoWTJzN0lIUmxlSFF0WVd4cFoyNDZZMlZ1ZEdWeUlqNEtJQ0E4WkdsMlBnb2dJQ0FnVkdocGN5QkNZV05vWld4dmNpQnZaaUJUWTJsbGJtTmxJR0Z1WkNCQmNuUnpJR2x6SUdOdmJtWmxjbkpsWkNCMGJ3b2dJRHd2WkdsMlBnb2dJRHh6ZEhKdmJtY2djM1I1YkdVOUltWnZiblF0YzJsNlpUb2dNVFp3ZUNJK0NpQWdJQ0JLWVc1bElGTnRhWFJvQ2lBZ1BDOXpkSEp2Ym1jK0NpQWdQR1JwZGo0S0lDQWdJR0o1SUVWNFlXMXdiR1VnVlc1cGRtVnljMmwwZVM0S0lDQThMMlJwZGo0S1BDOWthWFkrIiwiQHR5cGUiOiJXZWJSZW5kZXJpbmdUZW1wbGF0ZTIwMjIifV0sImlzc3VhbmNlRGF0ZSI6IjIwMjQtMDktMzBUMDg6MzE6MTYuODg4WiJ9.UFC7Zxk3sAqef5Rs7oJxDwv304TTNPQHV1xBr2sgWg-xpZBAfmFpXcxoYvxEf80I__c3TwI95GnFH9C7qJzIAg',
      },
    });
    const downloadButton = screen.getByText('Download JWT');
    expect(downloadButton).toBeInTheDocument();
  });
});
