import React from 'react';
import { publicAPI } from '@mock-app/services'
import { render, screen, getByText, act, fireEvent } from '@testing-library/react';
import {QRCodeScannerDialogButton} from '../components/QRCodeScannerDialogButton/QRCodeScannerDialogButton';
import {ScannerDialog} from '../components/QRCodeScannerDialogButton/ScannerDialog';

jest.mock('@mock-app/services', () => ({
    publicAPI: {
        get: jest.fn(),
    },
}));

jest.mock('../components/QRCodeScannerDialogButton/ScannerDialog', () => ({
    ScannerDialog: jest.fn(),
}))

describe('QRCodeScannerDialogButton', () => {
    beforeEach(() => {
        jest.resetAllMocks();
    });

    it('should render QRCodeScannerDialogButton', () => {
        render(<QRCodeScannerDialogButton onChange={jest.fn()} />);
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
            '@context': [
                'https://www.w3.org/2018/credentials/v1',
                'https://www.w3.org/2018/credentials/examples/v1'
            ],
            type: ['VerifiableCredential', 'UniversityDegreeCredential'],
            issuer: 'https://example.edu/issuers/565049',
            credentialSubject: {
                id: 'did:example:ebfeb1f712ebc6f1c276e12ec21',
                degree: {
                    type: 'BachelorDegree',
                    name: 'Bachelor of Science and Arts'
                }
            }
        }
        publicAPI.get = jest.fn().mockResolvedValue(result);
        act(() => {
            render(<QRCodeScannerDialogButton onChange={onChange} />);
        })

        act(() => {
            const button = getByText(document.body, 'ScanQR');
            fireEvent.click(button);
        });
      
        act(() => {
            const button = getByText(document.body, 'Click');
            fireEvent.click(button);
         })
       


        expect(publicAPI.get).toHaveBeenCalledWith(url);
        expect(await onChange).toHaveBeenCalledWith(result);
    })

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
        act(() => {
            render(<QRCodeScannerDialogButton onChange={onChange} />);
        })

        act(() => {
            const button = getByText(document.body, 'ScanQR');
            fireEvent.click(button);
        });

        act(() => {
            const button = getByText(document.body, 'Click');
            fireEvent.click(button);
        });

        expect(onChange).not.toHaveBeenCalled();
        expect(screen.getByText(/Invalid URL/i)).toBeInTheDocument();
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
        act(() => {
            render(<QRCodeScannerDialogButton onChange={onChange} />);
        })

        act(() => {
            const button = getByText(document.body, 'ScanQR');
            fireEvent.click(button);
        });

        act(() => {
            const button = getByText(document.body, 'Close');
            fireEvent.click(button);
        });

        expect(screen.queryByText('ScannerDialog')).not.toBeInTheDocument();
    });
});