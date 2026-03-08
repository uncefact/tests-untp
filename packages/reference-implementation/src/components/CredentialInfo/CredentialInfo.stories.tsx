import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CredentialInfo } from '../CredentialInfo';
import { storyCredentialMock } from '../__mocks__/StoryVCMock';

const meta = {
  title: 'Credential Info',
  component: CredentialInfo,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof CredentialInfo>;

export default meta;
type Story = StoryObj<typeof CredentialInfo>;

export const Default: Story = {
  args: { credential: storyCredentialMock },
  decorators: [(Story) => <Story />],
};
