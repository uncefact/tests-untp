import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CredentialTabs } from '../CredentialTabs';
import { storyCredentialMock } from '../__mocks__/StoryVCMock';

const meta = {
  title: 'Credential Tabs',
  component: CredentialTabs,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof CredentialTabs>;

export default meta;
type Story = StoryObj<typeof CredentialTabs>;

export const Default: Story = {
  args: { credential: storyCredentialMock },
  decorators: [(Story) => <Story />],
};
