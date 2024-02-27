import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Credential } from '../src/components/Credential';
import { storyCredentialMock } from './StoryVCMock';

const meta = {
  title: 'Credential',
  component: Credential,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Credential>;

export default meta;
type Story = StoryObj<typeof Credential>;

export const Default: Story = {
  args: { credential: storyCredentialMock },
  decorators: [(Story) => <Story />],
};
