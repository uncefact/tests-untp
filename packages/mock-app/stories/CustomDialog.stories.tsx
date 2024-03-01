import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CustomDialog } from '../src/components/CustomDialog';

const meta = {
  title: 'Custom Dialog',
  component: CustomDialog,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof CustomDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    open: true,
    onClose: () => {},
    title: 'Demo custom dialog',
    content: 'Dialog content',
  },
  decorators: [(Story) => <Story />],
};
