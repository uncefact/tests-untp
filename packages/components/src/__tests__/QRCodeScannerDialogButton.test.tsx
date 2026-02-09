import React from 'react';
import { publicAPI } from '@uncefact/untp-ri-services';
import { render, screen, getByText, fireEvent, waitFor } from '@testing-library/react';
import { processVerifiableCredentialData } from '../utils/importDataHelpers.js';
import { QRCodeScannerDialogButton } from '../components/QRCodeScannerDialogButton/QRCodeScannerDialogButton';
import { ScannerDialog } from '../components/QRCodeScannerDialogButton/ScannerDialog';
import { ImportDataType } from '../types/common.types';

jest.mock('@uncefact/untp-ri-services', () => ({
  publicAPI: {
    get: jest.fn(),
  },
}));

jest.mock('../components/QRCodeScannerDialogButton/ScannerDialog', () => ({
  ScannerDialog: jest.fn(),
}));

jest.mock('../utils/importDataHelpers.js', () => ({
  processVerifiableCredentialData: jest.fn(),
}));

describe('QRCodeScannerDialogButton, when type is JSON', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should render QRCodeScannerDialogButton', () => {
    render(<QRCodeScannerDialogButton type={ImportDataType.JSON} onChange={jest.fn()} />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('should call onChange with result when getQRCodeDataFromUrl is called with valid URL', async () => {
    const url = 'https://example.com';
    function MockScannerDialog({ onScanQRResult }: { onScanQRResult: (value: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={() => onScanQRResult(url)}>
          Click
        </button>
      );
    }

    (ScannerDialog as any).mockImplementation(MockScannerDialog);

    const onChange = jest.fn();
    const result = {
      '@context': ['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/2018/credentials/examples/v1'],
      type: ['VerifiableCredential', 'UniversityDegreeCredential'],
      issuer: 'https://example.edu/issuers/565049',
      credentialSubject: {
        id: 'did:example:ebfeb1f712ebc6f1c276e12ec21',
        degree: {
          type: 'BachelorDegree',
          name: 'Bachelor of Science and Arts',
        },
      },
    };
    publicAPI.get = jest.fn().mockResolvedValue(result);
    render(<QRCodeScannerDialogButton type={ImportDataType.JSON} onChange={onChange} />);

    const scanButton = getByText(document.body, 'ScanQR');
    fireEvent.click(scanButton);

    const clickButton = getByText(document.body, 'Click');
    fireEvent.click(clickButton);

    await waitFor(() => {
      expect(publicAPI.get).toHaveBeenCalledWith(url);
      expect(onChange).toHaveBeenCalledWith({ 'https://example.com': result });
    });
  });

  it('should show toast message with error message when getQRCodeDataFromUrl is called with invalid URL', async () => {
    const url = 'invalid-url';
    function MockScannerDialog({ onScanQRResult }: { onScanQRResult: (value: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={() => onScanQRResult(url)}>
          Click
        </button>
      );
    }

    (ScannerDialog as any).mockImplementation(MockScannerDialog);

    const onChange = jest.fn();
    render(<QRCodeScannerDialogButton type={ImportDataType.JSON} onChange={onChange} />);

    const scanButton = getByText(document.body, 'ScanQR');
    fireEvent.click(scanButton);

    const clickButton = getByText(document.body, 'Click');
    fireEvent.click(clickButton);

    await waitFor(() => {
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByText(/Invalid URL/i)).toBeInTheDocument();
    });
  });

  it('should close scanner dialog when close button is clicked', () => {
    function MockScannerDialog({ close }: { close: () => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={() => close()}>
          Close
        </button>
      );
    }

    (ScannerDialog as any).mockImplementation(MockScannerDialog);

    const onChange = jest.fn();
    render(<QRCodeScannerDialogButton type={ImportDataType.JSON} onChange={onChange} />);

    const scanButton = getByText(document.body, 'ScanQR');
    fireEvent.click(scanButton);

    const closeButton = getByText(document.body, 'Close');
    fireEvent.click(closeButton);

    expect(screen.queryByText('ScannerDialog')).not.toBeInTheDocument();
  });
});

describe('QRCodeScannerDialogButton, when type is VerifiableCredential', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should pass vcOptions to processVerifiableCredentialData', async () => {
    const url = 'https://example.com';
    const vcOptions = {
      credentialPath: '/path/to/credential',
      vckitAPIUrl: 'https://api.example.com',
      headers: { Authorization: 'Bearer token' },
    };

    function MockScannerDialog({ onScanQRResult }: { onScanQRResult: (value: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={() => onScanQRResult(url)}>
          Click
        </button>
      );
    }

    (ScannerDialog as any).mockImplementation(MockScannerDialog);

    const result = {
      '@context': ['https://www.w3.org/ns/credentials/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,jwt.abc.123',
    };

    publicAPI.get = jest.fn().mockResolvedValue(result);

    render(
      <QRCodeScannerDialogButton
        type={ImportDataType.VerifiableCredential}
        onChange={jest.fn()}
        vcOptions={vcOptions}
      />,
    );

    const scanButton = getByText(document.body, 'ScanQR');
    fireEvent.click(scanButton);

    const clickButton = getByText(document.body, 'Click');
    fireEvent.click(clickButton);

    await waitFor(() => {
      expect(processVerifiableCredentialData).toHaveBeenCalledWith(
        result,
        { vckitAPIUrl: vcOptions.vckitAPIUrl, headers: vcOptions.headers },
        vcOptions.credentialPath,
      );
    });
  });

  it('should call onChange with result when getQRCodeDataFromUrl is called with valid URL', async () => {
    const url = 'https://example.com';
    function MockScannerDialog({ onScanQRResult }: { onScanQRResult: (value: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={() => onScanQRResult(url)}>
          Click
        </button>
      );
    }

    (ScannerDialog as any).mockImplementation(MockScannerDialog);

    const onChange = jest.fn();
    const result = {
      '@context': ['https://www.w3.org/ns/credentials/v2', 'https://www.w3.org/ns/credentials/examples/v2'],
      type: 'EnvelopedVerifiableCredential',
      id: 'data:application/vc-ld+jwt,jwt.abc.123',
    };

    (processVerifiableCredentialData as jest.Mock).mockImplementation(() => ({
      vc: result,
      decodedEnvelopedVC: {
        type: ['VerifiableCredential'],
        credentialSubject: {
          id: 'did:example:123',
          name: 'Alice',
        },
      },
    }));

    publicAPI.get = jest.fn().mockResolvedValue(result);
    render(<QRCodeScannerDialogButton type={ImportDataType.VerifiableCredential} onChange={onChange} />);

    const scanButton = getByText(document.body, 'ScanQR');
    fireEvent.click(scanButton);

    const clickButton = getByText(document.body, 'Click');
    fireEvent.click(clickButton);

    await waitFor(() => {
      expect(publicAPI.get).toHaveBeenCalledWith(url);
      expect(onChange).toHaveBeenCalledWith({
        'https://example.com': {
          vc: result,
          decodedEnvelopedVC: {
            type: ['VerifiableCredential'],
            credentialSubject: {
              id: 'did:example:123',
              name: 'Alice',
            },
          },
        },
      });
    });
  });
});
