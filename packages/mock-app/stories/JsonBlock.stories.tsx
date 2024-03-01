import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { JsonBlock } from '../src/components/JsonBlock';
import { storyCredentialMock } from './StoryVCMock';

const meta = {
  title: 'Json Block',
  component: JsonBlock,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof JsonBlock>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { credential: storyCredentialMock },
  decorators: [(Story) => <Story />],
};
