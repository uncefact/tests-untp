import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CredentialTabs } from '../components/CredentialTabs';

// Mocking modules from @uncefact/vckit-renderer
jest.mock('@uncefact/vckit-renderer', () => ({
  Renderer: jest.fn(), // Mocking Renderer to be a Jest mock function
  WebRenderingTemplate2022: jest.fn(), // Mocking WebRenderingTemplate2022 to be a Jest mock function
}));

// Mocking the convertBase64ToString utility function from ../utils
jest.mock('../utils', () => ({
  convertBase64ToString: jest.fn().mockImplementation(() => '<div>Credential render</div>'), // Mocking the conversion function
}));

// Mocking MUI components
jest.mock('@mui/material', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Tab: ({ label, ...props }: { label?: string; [key: string]: unknown }) => (
    <button role='tab' {...props}>
      {label}
    </button>
  ),
  Tabs: ({
    children,
    value,
    onChange,
    variant,
    scrollButtons,
    ...props
  }: {
    children?: React.ReactNode;
    value?: number;
    onChange?: (event: React.SyntheticEvent, newValue: number) => void;
    variant?: string;
    scrollButtons?: boolean | string;
    [key: string]: unknown;
  }) => (
    <div role='tablist' {...props}>
      {React.Children.map(children, (child, index) => {
        if (React.isValidElement(child)) {
          return React.cloneElement(
            child as React.ReactElement<{ 'aria-selected'?: boolean; onClick?: (event: React.SyntheticEvent) => void }>,
            {
              'aria-selected': value === index,
              onClick: (event: React.SyntheticEvent) => onChange?.(event, index),
            },
          );
        }
        return child;
      })}
    </div>
  ),
  Button: ({
    children,
    onClick,
    variant,
    startIcon,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    startIcon?: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={`MuiButton-${variant || 'contained'}`} {...props}>
      {startIcon}
      {children}
    </button>
  ),
  IconButton: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  useTheme: () => ({
    breakpoints: {
      down: () => false,
    },
  }),
  useMediaQuery: () => false,
}));

// Mocking MUI icons
jest.mock('@mui/icons-material/CloudDownloadOutlined', () => {
  const MockCloudDownloadIcon = () => <span>📥</span>;
  MockCloudDownloadIcon.displayName = 'MockCloudDownloadIcon';
  return MockCloudDownloadIcon;
});

// Mocking the CredentialRender component
jest.mock('../components/CredentialRender/CredentialRender', () => {
  const MockCredentialRender = () => <>CredentialRender</>;
  MockCredentialRender.displayName = 'MockCredentialRender';
  return MockCredentialRender;
});
// Mocking the JsonBlock component
jest.mock('../components/JsonBlock/JsonBlock', () => {
  const MockJsonBlock = () => <>JsonBlock</>;
  MockJsonBlock.displayName = 'MockJsonBlock';
  return MockJsonBlock;
});
// Mocking the DownloadCredentialButton component
jest.mock('../components/DownloadCredentialButton/DownloadCredentialButton', () => ({
  DownloadCredentialButton: ({ credential }: { credential: unknown }) => {
    const handleClick = () => {
      const file = new Blob([JSON.stringify({ verifiableCredential: credential }, null, 2)], {
        type: 'text/plain',
      });
      URL.createObjectURL(file);
    };
    return <button onClick={handleClick}>Download</button>;
  },
}));

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
      renderMethod: [
        {
          template: '<div>Credential render</div>',
          '@type': 'WebRenderingTemplate2022',
        },
      ],
    };
    // Render the CredentialTabs component with the modified credential
    render(<CredentialTabs credential={credential2} />);
    // Expecting the text 'Rendered' to be present in the rendered component
    expect(screen.getByText('Rendered')).not.toBeNull();
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
