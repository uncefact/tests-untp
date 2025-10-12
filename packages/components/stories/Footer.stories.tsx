import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Footer } from '../src/components/Footer';

const meta = {
  title: 'Footer',
  component: Footer,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof Footer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
  decorators: [
    (Story) => (
      <div style={{ minWidth: '1000px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
