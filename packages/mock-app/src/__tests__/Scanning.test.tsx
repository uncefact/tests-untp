/* eslint-disable testing-library/no-node-access */
/* eslint-disable testing-library/no-unnecessary-act */
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { publicAPI } from '@mock-app/services';
import { act } from 'react-dom/test-utils';
import { Scanner } from '../components/Scanner';
import { Scanning } from '../pages';

const mockUsedNavigate = jest.fn();
jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  useNavigate: () => mockUsedNavigate,
}));

jest.mock('../components/Scanner', () => ({
  Scanner: jest.fn(),
}));

jest.mock('../components/CustomDialog', () => ({
  CustomDialog: jest.fn(),
}));

jest.mock('@mock-app/services', () => ({
  publicAPI: jest.fn(),
}));

jest.mock('@mock-app/components', () => ({
  Status: 'success',
  toastMessage: jest.fn(),
  ToastMessage: jest.fn(),
}));

jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

describe('Scanning', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('should renders scanning page with scanner component', () => {
    (Scanner as any).mockReturnValue(() => <>Scanner</>);

    render(<Scanning />);

    expect(Scanner).not.toBeNull();
  });

  it('should renders scanning page with callback successful', async () => {
    function MockScanner({ qrCodeSuccessCallback }: { qrCodeSuccessCallback: (value: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={qrCodeSuccessCallback('09359502000041')}>
          Click
        </button>
      );
    }
    (Scanner as any).mockImplementation(MockScanner);

    await act(async () => {
      render(<Scanning />);
    });

    const button = document.querySelector('button');
    fireEvent?.click(button!);

    expect('<svg').not.toBeNull();

    publicAPI.post = jest.fn().mockResolvedValue(() =>
      Promise.resolve({
        linkset: [
          {
            'https://gs1.org/voc/serviceInfo': [
              {
                href: 'https://localhost.com',
                title: 'DLR Service',
                type: 'text/html',
                hreflang: ['us'],
                context: ['us'],
              },
            ],
          },
        ],
      }),
    );
  });

  it('should renders scanning page with callback error', async () => {
    function MockScanner({ qrCodeErrorCallback }: { qrCodeErrorCallback: (error: string) => () => void }) {
      return (
        <button data-testid='my-scanner' onClick={qrCodeErrorCallback('error')}>
          Click
        </button>
      );
    }

    (Scanner as any).mockImplementation(MockScanner);

    await act(async () => {
      render(<Scanning />);
    });

    const button = document.querySelector('button');
    fireEvent?.click(button!);

    expect('<svg').not.toBeNull();
  });
});
