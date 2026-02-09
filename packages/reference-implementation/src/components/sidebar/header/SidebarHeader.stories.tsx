import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { SidebarHeader } from './SidebarHeader';

const meta = {
  title: 'Components/Sidebar/SidebarHeader',
  component: SidebarHeader,
  parameters: {
    layout: 'centered',
  },
  decorators: [
    (Story) => {
      return (
        <div className='bg-background p-8'>
          <Story />
        </div>
      );
    },
  ],
  argTypes: {
    logo: {
      control: false,
      description: 'Logo to display (can be a string URL or React node)',
    },
    onLogoClick: {
      action: 'logo clicked',
      description: 'Callback when logo is clicked',
    },
    className: {
      control: 'text',
      description: 'Additional CSS classes to apply to the component',
    },
  },
} satisfies Meta<typeof SidebarHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    logo: <span className='text-xl font-semibold'>UNTP</span>,
    onLogoClick: () => console.log('Logo clicked'),
  },
};

export const CustomLogo: Story = {
  args: {
    logo: <span className='text-2xl font-bold text-primary'>Custom Logo</span>,
    onLogoClick: () => console.log('Logo clicked'),
  },
};
