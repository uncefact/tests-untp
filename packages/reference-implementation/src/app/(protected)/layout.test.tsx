import { render, screen } from '@testing-library/react';
import ProtectedLayout from './layout';

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => '/dashboard',
}));

jest.mock('lucide-react', () => ({
  LogOut: () => <span>LogOut</span>,
}));

const mockUseAuth = jest.fn();

jest.mock('@/contexts/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => mockUseAuth(),
}));

jest.mock('@/contexts/did/DidContext', () => ({
  DidProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// Mocked so the absence assertions trip if the layout renders the sidebars again.
// The mocks render their test ids unconditionally (the real Sidebar swaps to a
// skeleton without its test id while loading) and avoid the real components'
// dependencies on '@reference-implementation/components', mocked below. See #715.
jest.mock('@/components/sidebar', () => ({
  Sidebar: () => <div data-testid='sidebar' />,
  MobileSidebar: () => <div data-testid='mobile-sidebar' />,
}));

jest.mock('@reference-implementation/components', () => ({
  Loader: () => <div data-testid='loader' />,
}));

describe('ProtectedLayout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAuth.mockReturnValue({
      user: { name: 'Test User', email: 'test@example.com', roles: [] },
      isLoading: false,
      isAuthenticated: true,
      logout: jest.fn(),
    });
  });

  it('renders children without the navigation sidebars', () => {
    render(
      <ProtectedLayout>
        <div data-testid='content'>Content</div>
      </ProtectedLayout>,
    );

    expect(screen.getByTestId('content')).toBeInTheDocument();
    expect(screen.queryByTestId('sidebar')).toBeNull();
    expect(screen.queryByTestId('mobile-sidebar')).toBeNull();
  });

  it('shows the loader while authentication is pending', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: true,
      isAuthenticated: false,
      logout: jest.fn(),
    });

    render(
      <ProtectedLayout>
        <div data-testid='content'>Content</div>
      </ProtectedLayout>,
    );

    expect(screen.getByTestId('loader')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('redirects to sign-in when unauthenticated', () => {
    mockUseAuth.mockReturnValue({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      logout: jest.fn(),
    });

    render(
      <ProtectedLayout>
        <div data-testid='content'>Content</div>
      </ProtectedLayout>,
    );

    expect(mockPush).toHaveBeenCalledWith('/api/auth/signin');
    expect(screen.getByTestId('loader')).toBeInTheDocument();
    expect(screen.queryByTestId('content')).toBeNull();
  });
});
