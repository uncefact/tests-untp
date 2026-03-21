import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProtectedLayout from './layout';

const mockPush = jest.fn();
const mockPathname = jest.fn(() => '/configuration/dids');

jest.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname(),
}));

jest.mock('@/contexts/auth', () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { name: 'Test User', email: 'test@example.com', roles: [] },
    isLoading: false,
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

jest.mock('@/components/sidebar', () => ({
  Sidebar: ({ onNavClick, selectedNavId }: { onNavClick: (id: string) => void; selectedNavId?: string }) => (
    <div data-testid='sidebar' data-selected-nav-id={selectedNavId}>
      <button data-testid='nav-dids' onClick={() => onNavClick('dids')}>
        DIDs
      </button>
      <button data-testid='nav-credentials' onClick={() => onNavClick('credentials')}>
        Credentials
      </button>
      <button data-testid='nav-resources' onClick={() => onNavClick('resources')}>
        Resources
      </button>
    </div>
  ),
  MobileSidebar: () => <div data-testid='mobile-sidebar' />,
}));

jest.mock('@reference-implementation/components', () => ({
  Loader: () => <div data-testid='loader' />,
}));

jest.mock('lucide-react', () => ({
  LogOut: () => <span>LogOut</span>,
}));

describe('ProtectedLayout navigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls router.push when clicking a mapped nav item', async () => {
    const user = userEvent.setup();
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    await user.click(screen.getByTestId('nav-dids'));

    expect(mockPush).toHaveBeenCalledWith('/configuration/dids');
  });

  it('does not call router.push when clicking an unmapped nav item', async () => {
    const user = userEvent.setup();
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    await user.click(screen.getByTestId('nav-credentials'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('does not call router.push for external nav items', async () => {
    const user = userEvent.setup();
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    await user.click(screen.getByTestId('nav-resources'));

    expect(mockPush).not.toHaveBeenCalled();
  });

  it('derives selectedNavId from the current pathname', () => {
    mockPathname.mockReturnValue('/configuration/dids');
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-selected-nav-id', 'dids');
  });

  it('sets selectedNavId to undefined for unrecognised paths', () => {
    mockPathname.mockReturnValue('/dashboard');
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    expect(screen.getByTestId('sidebar')).not.toHaveAttribute('data-selected-nav-id', 'dids');
  });

  it('matches sub-paths to the correct nav item', () => {
    mockPathname.mockReturnValue('/configuration/dids/create');
    render(
      <ProtectedLayout>
        <div>Content</div>
      </ProtectedLayout>,
    );

    expect(screen.getByTestId('sidebar')).toHaveAttribute('data-selected-nav-id', 'dids');
  });
});
