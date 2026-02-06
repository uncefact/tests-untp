import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { MobileSidebar } from './MobileSidebar';
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
  title: 'Components/Sidebar/MobileSidebar',
  component: MobileSidebar,
  parameters: {
    layout: 'fullscreen',
    viewport: {
      defaultViewport: 'mobile1',
    },
  },
  argTypes: {
    logo: {
      control: false,
      description: 'Logo to display in the mobile navbar (can be a string URL or React node)',
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
      description: 'Whether the sidebar is in a loading state',
    },
    autoCollapseInactive: {
      control: 'boolean',
      description: 'Whether to automatically collapse inactive expandable items',
    },
  },
} satisfies Meta<typeof MobileSidebar>;

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
    selectedNavId: 'identifiers',
    onNavClick: (nav: string) => console.log('Nav clicked:', nav),
    menuGroups: mockMenuGroups,
  },
};

export const IdentifiersSelected: Story = {
  args: {
    ...Default.args,
    selectedNavId: 'identifiers',
  },
};

export const ConformityCredentialSelected: Story = {
  args: {
    ...Default.args,
    selectedNavId: 'conformity-credential',
  },
  parameters: {
    docs: {
      description: {
        story: 'When a credential sub-item is selected, the Credentials section auto-expands.',
      },
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
        story:
          'Loading state showing the hamburger button. When opened, the sidebar displays skeleton placeholders while user data is being fetched.',
      },
    },
  },
};
