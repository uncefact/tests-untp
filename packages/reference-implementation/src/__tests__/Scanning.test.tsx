import React from 'react';
import { act, fireEvent, render } from '@testing-library/react';
import { publicAPI } from '@uncefact/untp-ri-services';
import { Scanner } from '../components/Scanner';
import Scanning from '../app/(public)/scanning/page';

const mockUsedNavigate = jest.fn();
jest.mock('react-router', () => ({
  ...jest.requireActual('react-router'),
  useNavigate: () => mockUsedNavigate,
}));

// Mock Next.js router
const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
    push: mockPush,
  }),
}));

// Mocking MUI components
jest.mock('@mui/material', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Button: ({
    children,
    onClick,
    variant,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={`MuiButton-${variant || 'contained'}`} {...props}>
      {children}
    </button>
  ),
  Typography: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Container: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Paper: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  CircularProgress: (props: { [key: string]: unknown }) => <div {...props}>Loading...</div>,
  Stack: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
}));

jest.mock('../components/Scanner', () => ({
  Scanner: jest.fn(),
}));

jest.mock('../components/CustomDialog', () => ({
  CustomDialog: jest.fn(),
}));

jest.mock('@uncefact/untp-ri-services', () => ({
  publicAPI: jest.fn(),
}));

jest.mock('@reference-implementation/components', () => ({
  Status: 'success',
  toastMessage: jest.fn(),
  ToastMessage: jest.fn(),
}));

jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

describe('Scanning', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    // Suppress expected console.log errors from error handling
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.resetAllMocks();
    jest.clearAllMocks();
    mockReplace.mockClear();
    mockPush.mockClear();
    mockUsedNavigate.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('should renders scanning page with scanner component', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Scanner as any).mockReturnValue(<>Scanner</>);

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (Scanner as any).mockImplementation(MockScanner);

    await act(async () => {
      render(<Scanning />);
    });

    const button = document.querySelector('button');
    fireEvent?.click(button!);

    expect('<svg').not.toBeNull();
  });
});
