import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import appConfig from './mocks/app-config.mock.json';

import Header from '../components/Header/Header';

// Mock the appConfig to provide test data
jest.mock('../../src/constants/app-config.json', () => appConfig, { virtual: true });

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  usePathname: () => '/',
}));

jest.mock('../hooks/GlobalContext', () => ({
  useGlobalContext: jest.fn(() => ({
    theme: {
      selectedTheme: { primaryColor: '#000000', secondaryColor: '#000000', tertiaryColor: '#000000' },
      setSelectedTheme: jest
        .fn()
        .mockImplementation(() => ({ primaryColor: '#000000', secondaryColor: '#000000', tertiaryColor: '#000000' })),
    },
  })),
}));

// Mocking MUI components
jest.mock('@mui/material', () => ({
  AppBar: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Toolbar: ({ children, disableGutters, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Container: ({ children, maxWidth, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
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
  Typography: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <div onClick={onClick} {...props}>
      {children}
    </div>
  ),
  Drawer: ({ children, open, ...props }: { children?: React.ReactNode; open?: boolean; [key: string]: unknown }) =>
    open ? <div {...props}>{children}</div> : null,
  List: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <ul {...props}>{children}</ul>
  ),
  ListItem: ({ children, disablePadding, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <li {...props}>{children}</li>
  ),
  ListItemButton: ({
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
  ListItemText: ({ primary, ...props }: { primary?: React.ReactNode; [key: string]: unknown }) => (
    <span {...props}>{primary}</span>
  ),
  ListItemIcon: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
  Box: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <div onClick={onClick} {...props}>
      {children}
    </div>
  ),
  Stack: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <div onClick={onClick} {...props}>
      {children}
    </div>
  ),
  Avatar: ({ alt, src, ...props }: { alt?: string; src?: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} {...props} />
  ),
  Divider: (props: { [key: string]: unknown }) => <hr {...props} />,
  Button: ({
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
}));

jest.mock('@mui/icons-material/Menu', () => {
  return function MenuIcon() {
    return <span>MenuIcon</span>;
  };
});

jest.mock('@mui/icons-material/Search', () => {
  return function SearchIcon() {
    return <span>SearchIcon</span>;
  };
});

jest.mock('@mui/icons-material/Dialpad', () => {
  return function DialpadIcon() {
    return <span>DialpadIcon</span>;
  };
});

jest.mock('next/link', () => {
  return function Link({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  };
});

describe('Header', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should render the header', () => {
    render(<Header />);
    expect(screen.getByText(appConfig.name)).toBeInTheDocument();
  });

  it('should open sidebar menu in header', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('icon-button'));
    expect(screen.getByTestId('menu')).toBeInTheDocument();
  });

  it('should display app name in sidebar when menu is opened', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('icon-button'));
    const linkElement = screen.getByTestId('app-name');
    expect(linkElement).toBeInTheDocument();
    expect(linkElement).toHaveAttribute('href', '/');
  });
});
