import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { NavMenu } from './NavMenu';
import { type NavMenuItemConfig } from '../nav-menu-item';
import { useState } from 'react';
import { Award, Settings, FileCheck, BookOpen, Shield, Factory, CreditCard, Workflow } from 'lucide-react';

const meta = {
  title: 'Components/Navigation/NavMenu',
  component: NavMenu,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => {
      return (
        <div className='w-[280px] bg-background p-4'>
          <Story />
        </div>
      );
    },
  ],
  argTypes: {
    items: {
      control: 'object',
      description: 'List of navigation items to display',
    },
    selectedNavId: {
      control: 'text',
      description: 'ID of the currently selected navigation item',
    },
    onNavClick: {
      action: 'nav clicked',
      description: 'Callback when a navigation item is clicked',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes to apply to the nav container',
    },
    autoCollapseInactive: {
      control: 'boolean',
      description: 'When true, clicking non-expandable items or sub-items auto-collapses other expanded items',
    },
  },
} satisfies Meta<typeof NavMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const mockNavItems: NavMenuItemConfig[] = [
  {
    id: 'credentials',
    label: 'Credentials',
    icon: <Award />,
    isExpandable: true,
    subItems: [
      {
        id: 'conformity-credential',
        label: 'Conformity credential',
        icon: <FileCheck />,
      },
      {
        id: 'facility-record',
        label: 'Facility record',
        icon: <Factory />,
      },
      {
        id: 'product-passport',
        label: 'Product passport',
        icon: <CreditCard />,
      },
      {
        id: 'traceability-event',
        label: 'Traceability event',
        icon: <Workflow />,
      },
    ],
  },
  {
    id: 'identifiers',
    label: 'Identifiers',
    icon: <Shield />,
  },
  {
    id: 'master-data',
    label: 'Master data',
    icon: <BookOpen />,
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: <BookOpen />,
    isExternal: true,
  },
];

export const Default: Story = {
  args: {
    items: mockNavItems,
  },
};

export const WithSelectedItem: Story = {
  args: {
    items: mockNavItems,
    selectedNavId: 'identifiers',
  },
};

export const WithSelectedSubItem: Story = {
  args: {
    items: mockNavItems,
    selectedNavId: 'conformity-credential',
  },
  parameters: {
    docs: {
      description: {
        story: 'When a sub-item is selected, its parent item is automatically expanded.',
      },
    },
  },
};

export const MixedIconTypes: Story = {
  args: {
    items: [
      {
        id: 'react-icon',
        label: 'React Icon',
        icon: <Settings />,
      },
      {
        id: 'no-icon',
        label: 'No Icon',
      },
      {
        id: 'another-icon',
        label: 'Another Icon',
        icon: <BookOpen />,
      },
    ],
    selectedNavId: 'react-icon',
  },
};

export const WithoutAutoCollapse: Story = {
  args: {
    items: mockNavItems,
    autoCollapseInactive: false,
  },
  render: (args) => {
    const InteractiveNav = () => {
      const [selectedId, setSelectedId] = useState<string>('identifiers');

      return <NavMenu {...args} selectedNavId={selectedId} onNavClick={(id) => setSelectedId(id)} />;
    };

    return <InteractiveNav />;
  },
  parameters: {
    docs: {
      description: {
        story:
          'With auto-collapse disabled. You can expand multiple sections and they will stay open until manually collapsed. This allows viewing multiple sections at once.',
      },
    },
  },
};

export const WithAutoCollapse: Story = {
  args: {
    items: mockNavItems,
    autoCollapseInactive: true,
  },
  render: (args) => {
    const InteractiveNav = () => {
      const [selectedId, setSelectedId] = useState<string>('identifiers');

      return <NavMenu {...args} selectedNavId={selectedId} onNavClick={(id) => setSelectedId(id)} />;
    };

    return <InteractiveNav />;
  },
  parameters: {
    docs: {
      description: {
        story:
          "With auto-collapse enabled (default behavior). Try expanding Credentials, then click on 'Identifiers' or any sub-item. Notice how other expanded sections automatically collapse, keeping the navigation clean and focused.",
      },
    },
  },
};

export const WithExternalLinks: Story = {
  args: {
    items: [
      {
        id: 'credentials',
        label: 'Credentials',
        icon: <Award />,
        isExpandable: true,
        subItems: [
          {
            id: 'conformity-credential',
            label: 'Conformity credential',
            icon: <FileCheck />,
          },
        ],
      },
      {
        id: 'identifiers',
        label: 'Identifiers',
        icon: <Shield />,
      },
      {
        id: 'resources',
        label: 'Resources',
        icon: <BookOpen />,
        isExternal: true,
      },
      {
        id: 'documentation',
        label: 'Documentation',
        icon: <BookOpen />,
        isExternal: true,
      },
    ],
    selectedNavId: 'resources',
  },
  parameters: {
    docs: {
      description: {
        story:
          'Navigation items can be marked as external links using the isExternal property. These items display an external link indicator (arrow) on the right side.',
      },
    },
  },
};
