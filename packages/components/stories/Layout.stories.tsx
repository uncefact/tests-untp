import React from 'react';
import { Typography } from '@mui/material';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { Layout } from '../src/components/Layout';

const meta = {
  title: 'Layout',
  component: Layout,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof Layout>;


export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: <Typography>Main layout here</Typography>,
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '1000px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
