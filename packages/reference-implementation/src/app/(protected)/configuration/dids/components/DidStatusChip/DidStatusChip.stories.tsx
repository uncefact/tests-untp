import type { Meta, StoryObj } from '@storybook/react-webpack5';
import DidStatusChip from './DidStatusChip';
import { DidStatus } from '@uncefact/untp-ri-services';

const meta = {
  title: 'Configuration/Dids/DidStatusChip',
  component: DidStatusChip,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    status: {
      control: 'select',
      options: Object.values(DidStatus),
      description: 'The DID status to display',
    },
  },
} satisfies Meta<typeof DidStatusChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Active: Story = {
  args: {
    status: DidStatus.ACTIVE,
  },
};

export const Verified: Story = {
  args: {
    status: DidStatus.VERIFIED,
  },
};

export const Unverified: Story = {
  args: {
    status: DidStatus.UNVERIFIED,
  },
};

export const VerificationFailed: Story = {
  args: {
    status: DidStatus.VERIFICATION_FAILED,
  },
};

export const Inactive: Story = {
  args: {
    status: DidStatus.INACTIVE,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className='flex flex-col gap-4'>
      {Object.values(DidStatus).map((status) => (
        <div key={status} className='flex items-center gap-4'>
          <span className='w-40 text-sm text-gray-500'>{status}</span>
          <DidStatusChip status={status} />
        </div>
      ))}
    </div>
  ),
};
