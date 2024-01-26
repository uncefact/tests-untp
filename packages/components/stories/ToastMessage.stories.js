import React from 'react';
import { ToastMessage, toastMessage, Status } from '../src/components/ToastMessage/ToastMessage';

export default {
  title: 'ToastMessage',
  component: ToastMessage,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};

const args =  {
  status: Status.success,
  message: 'Toast message!',
};

export const Default = {
  args,
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '40vh' }}>
          <Story />
          {toastMessage({ status: args.status, message: args.message })}
      </div>
    ),
  ],
};
