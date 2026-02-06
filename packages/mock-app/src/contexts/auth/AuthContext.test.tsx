import { render, screen, waitFor } from '@testing-library/react';
import { useSession, signOut } from 'next-auth/react';
import { AuthProvider, useAuth } from './AuthContext';
import { getIdpLogoutUrl } from '@/lib/auth/helpers';

// Mock dependencies
jest.mock('next-auth/react');
jest.mock('@/lib/auth/helpers');

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
const mockSignOut = signOut as jest.MockedFunction<typeof signOut>;
const mockGetIdpLogoutUrl = getIdpLogoutUrl as jest.MockedFunction<typeof getIdpLogoutUrl>;

// Test component that uses the useAuth hook
function TestComponent() {
  const { user, isLoading, isAuthenticated } = useAuth();

  return (
    <div>
      <div data-testid='loading'>{isLoading ? 'loading' : 'not-loading'}</div>
      <div data-testid='authenticated'>{isAuthenticated ? 'authenticated' : 'not-authenticated'}</div>
      {user && (
        <div data-testid='user'>
          <div data-testid='user-name'>{user.name}</div>
          <div data-testid='user-email'>{user.email}</div>
        </div>
      )}
    </div>
  );
}

describe('AuthContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('AuthProvider', () => {
    it('provides loading state when session is loading', () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'loading',
        update: jest.fn(),
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('loading');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
      expect(screen.queryByTestId('user')).not.toBeInTheDocument();
    });

    it('provides unauthenticated state when session is null', () => {
      mockUseSession.mockReturnValue({
        data: null,
        status: 'unauthenticated',
        update: jest.fn(),
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('not-authenticated');
    });

    it('provides authenticated user when session is available', () => {
      const mockSession = {
        user: {
          id: 'user-123',
          name: 'John Doe',
          email: 'john@example.com',
          image: 'https://example.com/avatar.jpg',
        },
        expires: '2024-12-31',
      };

      mockUseSession.mockReturnValue({
        data: mockSession,
        status: 'authenticated',
        update: jest.fn(),
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );

      expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      expect(screen.getByTestId('authenticated')).toHaveTextContent('authenticated');
      expect(screen.getByTestId('user-name')).toHaveTextContent('John Doe');
      expect(screen.getByTestId('user-email')).toHaveTextContent('john@example.com');
    });

    it('provides empty strings when user data is missing', () => {
      const mockSession = {
        user: {
          id: 'user-456',
        },
        expires: '2024-12-31',
      };

      mockUseSession.mockReturnValue({
        data: mockSession,
        status: 'authenticated',
        update: jest.fn(),
      });

      render(
        <AuthProvider>
          <TestComponent />
        </AuthProvider>,
      );

      expect(screen.getByTestId('user-name')).toHaveTextContent('');
      expect(screen.getByTestId('user-email')).toHaveTextContent('');
    });
  });

  describe('logout', () => {
    beforeEach(() => {
      // Mock window.location.href
      delete (window as unknown as { location: unknown }).location;
      (window as unknown as { location: { href: string } }).location = { href: '' };
    });

    it('calls signOut and redirects to IDP logout URL', async () => {
      const mockSession = {
        user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
        expires: '2024-12-31',
      };

      mockUseSession.mockReturnValue({
        data: mockSession,
        status: 'authenticated',
        update: jest.fn(),
      });

      mockGetIdpLogoutUrl.mockReturnValue('https://idp.example.com/logout');
      mockSignOut.mockResolvedValue({} as never);

      function LogoutTestComponent() {
        const { logout } = useAuth();
        return (
          <button onClick={logout} data-testid='logout-btn'>
            Logout
          </button>
        );
      }

      render(
        <AuthProvider>
          <LogoutTestComponent />
        </AuthProvider>,
      );

      const logoutBtn = screen.getByTestId('logout-btn');
      logoutBtn.click();

      await waitFor(() => {
        expect(mockGetIdpLogoutUrl).toHaveBeenCalledWith(mockSession);
        expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
        expect(window.location.href).toBe('https://idp.example.com/logout');
      });
    });

    it('redirects to home when IDP logout URL is not available', async () => {
      const mockSession = {
        user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
        expires: '2024-12-31',
      };

      mockUseSession.mockReturnValue({
        data: mockSession,
        status: 'authenticated',
        update: jest.fn(),
      });

      mockGetIdpLogoutUrl.mockReturnValue(null);
      mockSignOut.mockResolvedValue({} as never);

      function LogoutTestComponent() {
        const { logout } = useAuth();
        return (
          <button onClick={logout} data-testid='logout-btn'>
            Logout
          </button>
        );
      }

      render(
        <AuthProvider>
          <LogoutTestComponent />
        </AuthProvider>,
      );

      const logoutBtn = screen.getByTestId('logout-btn');
      logoutBtn.click();

      await waitFor(() => {
        expect(mockSignOut).toHaveBeenCalledWith({ redirect: false });
        expect(window.location.href).toBe('/');
      });
    });

    it('logs error when logout fails', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      const mockSession = {
        user: { id: 'user-123', name: 'John Doe', email: 'john@example.com' },
        expires: '2024-12-31',
      };

      mockUseSession.mockReturnValue({
        data: mockSession,
        status: 'authenticated',
        update: jest.fn(),
      });

      const error = new Error('Logout failed');
      mockSignOut.mockRejectedValue(error);

      function LogoutTestComponent() {
        const { logout } = useAuth();
        return (
          <button onClick={logout} data-testid='logout-btn'>
            Logout
          </button>
        );
      }

      render(
        <AuthProvider>
          <LogoutTestComponent />
        </AuthProvider>,
      );

      const logoutBtn = screen.getByTestId('logout-btn');
      logoutBtn.click();

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error signing out:', error);
      });

      consoleErrorSpy.mockRestore();
    });
  });

  describe('useAuth', () => {
    it('throws error when used outside AuthProvider', () => {
      // Suppress console error for this test
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      function TestComponentOutsideProvider() {
        useAuth();
        return null;
      }

      expect(() => {
        render(<TestComponentOutsideProvider />);
      }).toThrow('useAuth must be used within an AuthProvider');

      consoleErrorSpy.mockRestore();
    });
  });
});
