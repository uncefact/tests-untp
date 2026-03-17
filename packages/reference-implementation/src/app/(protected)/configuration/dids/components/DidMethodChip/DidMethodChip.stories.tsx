import type { Meta, StoryObj } from '@storybook/react-webpack5';
import DidMethodChip from './DidMethodChip';
import { DidMethod } from '@uncefact/untp-ri-services';

const meta = {
  title: 'Configuration/Dids/DidMethodChip',
  component: DidMethodChip,
  parameters: {
    layout: 'centered',
  },
  tags: ['autodocs'],
  argTypes: {
    method: {
      control: 'select',
      options: Object.values(DidMethod),
      description: 'The DID method to display',
    },
  },
} satisfies Meta<typeof DidMethodChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const DidWeb: Story = {
  args: {
    method: DidMethod.DID_WEB,
  },
};

export const DidWebVh: Story = {
  args: {
    method: DidMethod.DID_WEB_VH,
  },
};

export const AllVariants: Story = {
  render: () => (
    <div className='flex flex-col gap-4'>
      {Object.values(DidMethod).map((method) => (
        <div key={method} className='flex items-center gap-4'>
          <span className='w-40 text-sm text-gray-500'>{method}</span>
          <DidMethodChip method={method} />
        </div>
      ))}
    </div>
  ),
};
