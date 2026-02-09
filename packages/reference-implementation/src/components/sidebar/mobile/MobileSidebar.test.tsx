import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MobileSidebar } from './MobileSidebar';
import {
  UserRole,
  type User,
  type NavMenuItemConfig,
  type MoreOptionGroup,
} from '@reference-implementation/components';

const mockUser: User = {
  name: 'Cindy Reardon',
  email: 'c.reardon@emailadress.com',
  roles: [UserRole.Admin],
};

const mockNavItems: NavMenuItemConfig[] = [
  {
    id: 'credentials',
    label: 'Credentials',
    icon: '/icons/license.svg',
    isExpandable: true,
    subItems: [
      {
        id: 'conformity-credential',
        label: 'Conformity credential',
        icon: '/icons/approval.svg',
      },
      {
        id: 'facility-record',
        label: 'Facility record',
        icon: '/icons/precision_manufacturing.svg',
      },
      {
        id: 'product-passport',
        label: 'Product passport',
        icon: '/icons/passport.svg',
      },
      {
        id: 'traceability-event',
        label: 'Traceability event',
        icon: '/icons/blur_medium.svg',
      },
    ],
  },
  {
    id: 'identifiers',
    label: 'Identifiers',
    icon: '/icons/admin_panel_settings.svg',
  },
  {
    id: 'master-data',
    label: 'Master data',
    icon: '/icons/book_ribbon.svg',
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: '/icons/settings.svg',
    isExpandable: true,
  },
];

const mockMenuGroups: MoreOptionGroup[] = [
  {
    options: [
      {
        label: 'Logout',
        onClick: jest.fn(),
      },
    ],
  },
];

const defaultProps = {
  user: mockUser,
  logo: '/logo.png',
  onLogoClick: jest.fn(),
  navItems: mockNavItems,
  menuGroups: mockMenuGroups,
  onNavClick: jest.fn(),
};

describe('MobileSidebar', () => {
  it('renders the mobile navbar', () => {
    render(<MobileSidebar {...defaultProps} />);

    expect(screen.getByTestId('mobile-navbar')).toBeInTheDocument();
  });

  it('renders the hamburger button', () => {
    render(<MobileSidebar {...defaultProps} />);

    expect(screen.getByTestId('mobile-sidebar-toggle')).toBeInTheDocument();
  });

  it('sidebar is hidden by default', () => {
    render(<MobileSidebar {...defaultProps} />);

    const sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('-translate-x-full');
  });

  it('opens sidebar when hamburger is clicked', async () => {
    const user = userEvent.setup();
    render(<MobileSidebar {...defaultProps} />);

    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    const sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('translate-x-0');
    expect(sidebar).not.toHaveClass('-translate-x-full');
  });

  it('shows overlay when sidebar is open', async () => {
    const user = userEvent.setup();
    render(<MobileSidebar {...defaultProps} />);

    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    expect(screen.getByTestId('mobile-sidebar-overlay')).toBeInTheDocument();
  });

  it('closes sidebar when overlay is clicked', async () => {
    const user = userEvent.setup();
    render(<MobileSidebar {...defaultProps} />);

    // Open sidebar
    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    // Click overlay
    const overlay = screen.getByTestId('mobile-sidebar-overlay');
    await user.click(overlay);

    const sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('-translate-x-full');
  });

  it('closes sidebar when hamburger is clicked again', async () => {
    const user = userEvent.setup();
    render(<MobileSidebar {...defaultProps} />);

    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');

    // Open
    await user.click(toggleButton);
    let sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('translate-x-0');

    // Close
    await user.click(toggleButton);
    sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('-translate-x-full');
  });

  it('closes sidebar when nav item is clicked', async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(<MobileSidebar {...defaultProps} onNavClick={handleNavClick} />);

    // Open sidebar
    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    // Click nav item
    const identifiersText = screen.getByText('Identifiers');
    await user.click(identifiersText);

    expect(handleNavClick).toHaveBeenCalledWith('identifiers');

    const sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('-translate-x-full');
  });

  it('closes sidebar when credential sub-item is clicked', async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(<MobileSidebar {...defaultProps} onNavClick={handleNavClick} />);

    // Open sidebar
    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    // Expand credentials
    const chevron = screen.getByTestId('nav-menu-item-credentials-chevron');
    await user.click(chevron);

    // Click a sub-item
    const facilityRecordText = screen.getByText('Facility record');
    await user.click(facilityRecordText);

    expect(handleNavClick).toHaveBeenCalledWith('facility-record');

    const sidebar = screen.getByTestId('mobile-sidebar');
    expect(sidebar).toHaveClass('-translate-x-full');
  });

  it('renders with custom className on navbar', () => {
    render(<MobileSidebar {...defaultProps} className='custom-class' />);

    const navbar = screen.getByTestId('mobile-navbar');
    expect(navbar).toHaveClass('custom-class');
  });

  it('shows logo in mobile navbar', () => {
    render(<MobileSidebar {...defaultProps} />);

    const logoButton = screen.getByTestId('mobile-navbar-logo');
    expect(logoButton).toBeInTheDocument();

    const logoImage = screen.getByAltText('Logo');
    expect(logoImage).toHaveAttribute('src');
    expect(decodeURIComponent(logoImage.getAttribute('src') || '')).toContain('/logo.png');
  });

  it('calls onLogoClick when logo is clicked in mobile navbar', async () => {
    const user = userEvent.setup();
    const handleLogoClick = jest.fn();

    render(<MobileSidebar {...defaultProps} onLogoClick={handleLogoClick} />);

    const logoButton = screen.getByTestId('mobile-navbar-logo');
    await user.click(logoButton);

    expect(handleLogoClick).toHaveBeenCalledTimes(1);
  });

  it('passes isLoading prop to Sidebar', () => {
    render(<MobileSidebar {...defaultProps} isLoading={true} />);

    // When loading, sidebar should render skeleton
    expect(screen.queryByTestId('sidebar')).not.toBeInTheDocument();
  });

  it('passes selectedNavId prop to Sidebar', async () => {
    const user = userEvent.setup();
    render(<MobileSidebar {...defaultProps} selectedNavId='identifiers' />);

    // Open sidebar
    const toggleButton = screen.getByTestId('mobile-sidebar-toggle');
    await user.click(toggleButton);

    // Check that identifiers is rendered with active state
    const identifiersButton = screen.getByTestId('nav-menu-item-identifiers');
    expect(identifiersButton).toHaveClass('bg-nav-item-active');
  });
});
