import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

import Header from './Header';

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: jest.fn(),
    replace: jest.fn(),
  }),
  usePathname: () => '/',
}));

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
  Divider: (props: { [key: string]: unknown }) => <hr {...props} />,
}));

jest.mock('@mui/icons-material/Menu', () => {
  return function MenuIcon() {
    return <span>MenuIcon</span>;
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
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message) => {
      if (typeof message === 'string' && message.includes('Invalid value for prop')) {
        return;
      }
      console.warn(message);
    });
    jest.clearAllMocks();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should render the application name', () => {
    render(<Header />);
    expect(screen.getByText('UNTP Reference Implementation')).toBeInTheDocument();
  });

  it('should open the drawer when the menu icon is clicked', () => {
    render(<Header />);

    fireEvent.click(screen.getByTestId('icon-button'));
    // Drawer opens and shows the app name
    expect(screen.getAllByText('UNTP Reference Implementation').length).toBeGreaterThanOrEqual(2);
  });
});
