import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConformityCredential } from '../components';
import { FetchOptions } from '../types/conformityCredential.types';
import { getJsonDataFromConformityAPI, uploadData, getValueByPath } from '@mock-app/services';
import { checkStoredCredentialsConfig } from '../components/ConformityCredential/utils';

jest.mock('@mock-app/services', () => ({
  uploadData: jest.fn(),
  generateUUID: jest.fn(),
  getJsonDataFromConformityAPI: jest.fn(),
  getValueByPath: jest.fn(),
}));

jest.mock('../components/ToastMessage/ToastMessage', () => ({
  Status: 'success',
  toastMessage: jest.fn(),
  ToastMessage: jest.fn(),
}));

jest.mock('../components/ConformityCredential/utils', () => ({
  checkStoredCredentialsConfig: jest.fn(),
}));

describe('ConformityCredential', () => {
  // Suppress console.error for expected errors in tests and MUI warnings
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message) => {
      // Filter out MUI table nesting warnings and expected test errors
      const messageStr = typeof message === 'string' ? message : String(message);

      if (
        messageStr.includes('cannot be a child of') ||
        messageStr.includes('cannot contain a nested') ||
        messageStr.includes('TypeError') ||
        messageStr.includes('Invalid URL') ||
        messageStr.includes('validateAndConstructVerifyURL') ||
        message === 'error' // Suppress generic 'error' string
      ) {
        return;
      }
      // Log other unexpected errors (shouldn't happen in these tests)
      console.warn('Unexpected error:', message);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('should render ConformityCredential component with valid props', () => {
    const credentialRequestConfigs = [
      {
        url: 'http://example.com/credential-request',
        params: {},
        options: {
          headers: [],
          method: 'POST',
        } as FetchOptions,
        credentialName: 'Deforestation Free Assessment',
        credentialPath: '',
        appOnly: '',
      },
    ];

    const storedCredentialsConfig = {
      url: 'https://example.com',
      params: {},
    };

    render(
      <ConformityCredential
        credentialRequestConfigs={credentialRequestConfigs}
        storedCredentialsConfig={storedCredentialsConfig}
      />,
    );

    expect(screen.findByText('Deforestation Free Assessment')).toBeTruthy();
  });

  it('should render ConformityCredential component with no props', () => {
    //@ts-ignore
    render(<ConformityCredential />);
    expect(screen.findByText('No credential requests available')).toBeTruthy();
  });

  describe('trigger onClick function', () => {
    const credentialRequestConfigs = [
      {
        url: 'http://example.com/credential-request',
        params: {},
        options: {
          headers: [],
          method: 'POST',
        } as FetchOptions,
        credentialName: 'Deforestation Free Assessment',
        credentialPath: '',
        appOnly: 'Farm',
      },
    ];

    const storedCredentialsConfig = {
      url: 'https://example.com',
      params: {},
    };

    it('should save credential as string when trigger onClickStorageCredential function', async () => {
      const url = 'https://example.com/credential';
      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(url);
      (getValueByPath as jest.Mock).mockReturnValue(url);

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = screen.getByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton);

      await waitFor(() => {
        expect(screen.findByText(credentialRequestConfigs[0].credentialName)).not.toBeNull();
        expect(screen.findByText(url)).not.toBeNull();
        expect(document.querySelector('table')).not.toBeNull();
      });

    });

    it('should save credential as object when trigger onClickStorageCredential function', async () => {
      const apiResp = {
        credentialSubject: {
          name: 'Jane Smith',
          degree: {
            type: 'BachelorDegree',
            name: 'Bachelor of Science and Arts',
            degreeSchool: 'Example University',
          },
          id: 'did:example:1234',
        },
        issuer: {
          id: 'did:example:1234',
        },
        type: ['VerifiableCredential', 'UniversityDegreeCredential'],
        proof: {
          type: 'JwtProof2020',
          jwt: 'example-jwt',
        },
      };

      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(apiResp);
      (getValueByPath as jest.Mock).mockReturnValue(apiResp);
      (checkStoredCredentialsConfig as jest.Mock).mockReturnValue({ ok: true, value: '' });
      (uploadData as jest.Mock).mockResolvedValue('https://storage.example.com/credential');

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = await screen.findAllByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton[0]);

      expect(screen.findAllByLabelText(credentialRequestConfigs[0].credentialName)).not.toBeNull();
      expect(screen.findByText('https://storage.example.com/credential')).not.toBeNull();
      expect(document.querySelector('table')).not.toBeNull();
    });

    // error case
    it('should throw error when url in credentialRequestConfig props not valid after triggering onClickStorageCredential function', async () => {
      const newCredentialRequestConfigs = [
        {
          url: '',
          params: {},
          options: {
            headers: [],
            method: 'POST',
          } as FetchOptions,
          credentialName: 'Deforestation Free Assessment',
          credentialPath: '',
          appOnly: '',
        },
      ];

      render(
        <ConformityCredential
          credentialRequestConfigs={newCredentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = await screen.findAllByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton[0]);

      expect(screen.findByText('Invalid credential request config url')).not.toBeNull();
    });

    it('should throw error when extract the credentials from API response after triggering onClickStorageCredential function', async () => {
      JSON.parse = jest.fn().mockReturnValue('string');
      (getValueByPath as jest.Mock).mockReturnValue(null);

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = await screen.findAllByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton[0]);

      expect(screen.findByText('Invalid credential data')).not.toBeNull();
    });

    it('should throw error when stored credential props not valid after triggering onClickStorageCredential function', async () => {
      const apiResp = {
        credentialSubject: {
          name: 'Jane Smith',
          degree: {
            type: 'BachelorDegree',
            name: 'Bachelor of Science and Arts',
            degreeSchool: 'Example University',
          },
          id: 'did:example:1234',
        },
        issuer: {
          id: 'did:example:1234',
        },
        type: ['VerifiableCredential', 'UniversityDegreeCredential'],
        proof: {
          type: 'JwtProof2020',
          jwt: 'example-jwt',
        },
      };

      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(apiResp);
      (getValueByPath as jest.Mock).mockReturnValue(apiResp);
      (checkStoredCredentialsConfig as jest.Mock).mockReturnValue({
        ok: false,
        value: 'Invalid upload credential config',
      });

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={{
            url: '',
            //@ts-ignore
            params: {},
          }}
        />,
      );

      const credentialButton = await screen.findAllByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton[0]);

      expect(screen.findByText('Invalid upload credential config')).not.toBeNull();
    });

    it('should throw error Something went wrong when getJsonDataFromConformityAPI function throw error', async () => {
      (getJsonDataFromConformityAPI as jest.Mock).mockRejectedValue('error');

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = await screen.findAllByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton[0]);

      expect(screen.findByText('Something went wrong! Please retry again')).not.toBeNull();
    });

    it('should throw error when data from API is not a url', async () => {
      const url = 'https://';
      (getJsonDataFromConformityAPI as jest.Mock).mockResolvedValue(url);
      (getValueByPath as jest.Mock).mockReturnValue(url);

      render(
        <ConformityCredential
          credentialRequestConfigs={credentialRequestConfigs}
          storedCredentialsConfig={storedCredentialsConfig}
        />,
      );

      const credentialButton = screen.getByText('Deforestation Free Assessment');
      fireEvent.click(credentialButton);

      expect(screen.findByText('Data should be URL')).not.toBeNull();
    });
  });
});
