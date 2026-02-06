import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { SidebarFooter } from "./SidebarFooter";
import { UserRole, type MoreOptionGroup } from "@reference-implementation/components";
import { LogOut } from "lucide-react";

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
  title: 'Components/Sidebar/SidebarFooter',
  component: SidebarFooter,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => {
      return (
        <div className='w-72 flex flex-col'>
          <Story />
        </div>
      );
    },
  ],
  argTypes: {
    user: {
      control: 'object',
      description: 'User object containing name, email, and roles',
    },
    menuGroups: {
      control: 'object',
      description: 'Groups of menu options displayed in the more options dropdown',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes to apply to the footer',
    },
  },
} satisfies Meta<typeof SidebarFooter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: {
      name: 'Cindy Reardon',
      email: 'c.reardon@emailadress.com',
      roles: [UserRole.User],
    },
    menuGroups: mockMenuGroups,
  },
};

export const LongUserInfo: Story = {
  args: {
    user: {
      name: 'Christina Marie Reardon-Smith',
      email: 'christina.marie.reardon-smith@verylongemailaddress.com',
      roles: [UserRole.User],
    },
    menuGroups: mockMenuGroups,
  },
};
