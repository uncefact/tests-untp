import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SidebarFooter } from './SidebarFooter';
import { UserRole, type User, type MoreOptionGroup } from '@mock-app/components';

const mockUser: User = {
  name: 'Cindy Reardon',
  email: 'c.reardon@emailadress.com',
  roles: [UserRole.User],
};

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

describe('SidebarFooter', () => {
  it('renders the component', () => {
    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} />);

    expect(screen.getByTestId('sidebar-footer')).toBeInTheDocument();
  });

  it('renders the user profile', () => {
    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} />);

    expect(screen.getByTestId('user-profile')).toBeInTheDocument();
    expect(screen.getByText('Cindy Reardon')).toBeInTheDocument();
    expect(screen.getByText('c.reardon@emailadress.com')).toBeInTheDocument();
  });

  it('renders the more options menu', () => {
    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} />);

    expect(screen.getByTestId('sidebar-menu-trigger')).toBeInTheDocument();
  });

  it('shows menu options when menu is clicked', async () => {
    const user = userEvent.setup();

    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} />);

    const menuTrigger = screen.getByTestId('sidebar-menu-trigger');
    await user.click(menuTrigger);

    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('calls option onClick when menu item is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();

    const customMenuGroups: MoreOptionGroup[] = [
      {
        options: [
          {
            label: 'Logout',
            onClick: handleClick,
          },
        ],
      },
    ];

    render(<SidebarFooter user={mockUser} menuGroups={customMenuGroups} />);

    const menuTrigger = screen.getByTestId('sidebar-menu-trigger');
    await user.click(menuTrigger);

    const logoutButton = screen.getByText('Logout');
    await user.click(logoutButton);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders multiple menu groups', async () => {
    const user = userEvent.setup();

    const multipleGroups: MoreOptionGroup[] = [
      {
        options: [
          {
            label: 'Profile',
            onClick: jest.fn(),
          },
          {
            label: 'Settings',
            onClick: jest.fn(),
          },
        ],
      },
      {
        options: [
          {
            label: 'Logout',
            onClick: jest.fn(),
          },
        ],
      },
    ];

    render(<SidebarFooter user={mockUser} menuGroups={multipleGroups} />);

    const menuTrigger = screen.getByTestId('sidebar-menu-trigger');
    await user.click(menuTrigger);

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Logout')).toBeInTheDocument();
  });

  it('passes user object to UserProfile', () => {
    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} />);

    // Profile component is rendered
    const profile = screen.getByTestId('user-profile');
    expect(profile).toBeInTheDocument();
  });

  it('applies custom className', () => {
    render(<SidebarFooter user={mockUser} menuGroups={mockMenuGroups} className='custom-class' />);

    const footer = screen.getByTestId('sidebar-footer');
    expect(footer).toHaveClass('custom-class');
  });
});
