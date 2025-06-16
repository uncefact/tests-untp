import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DynamicComponentRenderer } from '../build/components/DynamicComponentRenderer/DynamicComponentRenderer';

const meta: any = {
  title: 'DynamicComponentRenderer',
  component: DynamicComponentRenderer,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof DynamicComponentRenderer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    name: 'ImportButton',
    props: {},
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
