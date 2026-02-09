import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { UserProfile } from './UserProfile';
import { UserRole } from '@/types';

const meta = {
  title: 'Components/User/UserProfile',
  component: UserProfile,
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
    user: {
      control: 'object',
      description: 'User object containing name, email, and roles',
    },
  },
} satisfies Meta<typeof UserProfile>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    user: {
      name: 'John Doe',
      email: 'john@example.com',
      roles: [UserRole.User],
    },
  },
};

export const TruncatedName: Story = {
  args: {
    user: {
      name: 'Dr. Christopher Alexander Montgomery Wellington III',
      email: 'c.montgomery@example.com',
      roles: [UserRole.User],
    },
  },
};

export const TruncatedEmail: Story = {
  args: {
    user: {
      name: 'Jane Doe',
      email: 'jane.doe.with.a.very.long.email.address@corporate-company-domain.com',
      roles: [UserRole.User],
    },
  },
};

export const BothTruncated: Story = {
  args: {
    user: {
      name: 'Dr. Alexander Christopher Montgomery Wellington',
      email: 'alexander.christopher.montgomery@very-long-corporate-domain.com',
      roles: [UserRole.User],
    },
  },
};
