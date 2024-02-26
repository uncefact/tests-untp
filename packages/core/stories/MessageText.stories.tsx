import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { MessageText } from '../src/components/MessageText';
import { Status } from '@mock-app/components';

const meta = {
  title: 'Message text',
  component: MessageText,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof MessageText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    status: Status.error,
    text: 'Network error',
  },
  decorators: [(Story) => <Story />],
};
