import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ToastMessage, toastMessage, Status } from '../src/components/ToastMessage/ToastMessage';

const meta = {
  title: 'ToastMessage',
  component: ToastMessage,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof ToastMessage>;


export default meta;
type Story = StoryObj<typeof meta>;

const args =  {
  status: Status.success,
  message: 'Toast message!',
};

export const Default: Story = {
  args,
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '40vh' }}>
          <Story />
          {toastMessage({ status: args.status, message: args.message }) as React.ReactNode}
      </div>
    ),
  ],
};
