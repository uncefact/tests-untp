import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { Sidebar } from './Sidebar';
import { UserRole, type NavMenuItemConfig, type MoreOptionGroup } from '@mock-app/components';
import { LogOut, FileText, ShieldCheck, Factory, BookOpen, Workflow, Key, Database, BookMarked } from 'lucide-react';

const mockNavItems: NavMenuItemConfig[] = [
  {
    id: 'credentials',
    label: 'Credentials',
    icon: <FileText className='w-5 h-5' />,
    isExpandable: true,
    subItems: [
      {
        id: 'conformity-credential',
        label: 'Conformity credential',
        icon: <ShieldCheck className='w-5 h-5' />,
      },
      {
        id: 'facility-record',
        label: 'Facility record',
        icon: <Factory className='w-5 h-5' />,
      },
      {
        id: 'product-passport',
        label: 'Product passport',
        icon: <BookOpen className='w-5 h-5' />,
      },
      {
        id: 'traceability-event',
        label: 'Traceability event',
        icon: <Workflow className='w-5 h-5' />,
      },
    ],
  },
  {
    id: 'identifiers',
    label: 'Identifiers',
    icon: <Key className='w-5 h-5' />,
  },
  {
    id: 'master-data',
    label: 'Master data',
    icon: <Database className='w-5 h-5' />,
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: <BookMarked className='w-5 h-5' />,
    isExpandable: true,
  },
];

const mockMenuGroups: MoreOptionGroup[] = [
  {
    options: [
      {
        label: (
          <span className='flex items-center gap-2'>
            <LogOut className='w-4 h-4' />
            Logout
          </span>
        ),
        onClick: () => console.log('Logout clicked'),
      },
    ],
  },
];

const meta = {
  title: 'Components/Sidebar/Sidebar',
  component: Sidebar,
  decorators: [
    (Story) => (
      <div style={{ display: 'flex', height: '100vh' }}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
  argTypes: {
    logo: {
      control: false,
      description: 'Logo to display in the sidebar header (can be a string URL or React node)',
    },
    onLogoClick: {
      action: 'logo clicked',
      description: 'Callback when logo is clicked',
    },
    navItems: {
      control: 'object',
      description: 'Array of navigation items',
    },
    selectedNavId: {
      control: 'text',
      description: 'ID of the selected navigation item',
    },
    onNavClick: {
      action: 'nav clicked',
      description: 'Callback when a navigation item is clicked',
    },
    user: {
      control: 'object',
      description: 'User object containing name, email, roles, and optional avatarUrl',
    },
    menuGroups: {
      control: 'object',
      description: 'Groups of menu options displayed in the more options dropdown',
    },
    isLoading: {
      control: 'boolean',
      description: 'Whether to show the loading skeleton state',
    },
    hideHeader: {
      control: 'boolean',
      description: 'Whether to hide the header section',
    },
    autoCollapseInactive: {
      control: 'boolean',
      description: 'Whether to automatically collapse inactive expandable items',
    },
  },
} satisfies Meta<typeof Sidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: {
      name: 'Cindy Reardon',
      email: 'c.reardon@emailadress.com',
      roles: [UserRole.Admin],
    },
    logo: <span className='text-xl font-semibold'>UNTP</span>,
    onLogoClick: () => console.log('Logo clicked'),
    navItems: mockNavItems,
    selectedNavId: 'credentials',
    onNavClick: (nav: string) => console.log('Nav clicked:', nav),
    menuGroups: mockMenuGroups,
  },
};

export const SubItemSelected: Story = {
  args: {
    ...Default.args,
    selectedNavId: 'conformity-credential',
  },
};

export const LongUserInfo: Story = {
  args: {
    ...Default.args,
    selectedNavId: 'conformity-credential',
    user: {
      name: 'Christina Marie Reardon-Smith',
      email: 'christina.marie.reardon-smith@verylongemailaddress.com',
      roles: [UserRole.Admin],
    },
  },
};

export const Loading: Story = {
  args: {
    ...Default.args,
    isLoading: true,
  },
  parameters: {
    docs: {
      description: {
        story: 'Loading state with skeleton placeholders. This is shown while user data is being fetched.',
      },
    },
  },
};
