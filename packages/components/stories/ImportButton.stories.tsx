import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { ImportButton } from '../src/components/ImportButton/ImportButton';

const meta: any = {
  title: 'ImportButton',
  component: ImportButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof ImportButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'Import',
    onChange: (data) => console.log(data),
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
