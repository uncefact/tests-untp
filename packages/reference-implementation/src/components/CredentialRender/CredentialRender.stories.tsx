import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CredentialRender } from '../CredentialRender';
import { storyCredentialMock } from '../__mocks__/StoryVCMock';

const meta = {
  title: 'Credential Render',
  component: CredentialRender,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof CredentialRender>;

export default meta;
type Story = StoryObj<typeof CredentialRender>;

export const Default: Story = {
  args: { credential: storyCredentialMock },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '60vh' }}>
        <Story />
      </div>
    ),
  ],
};
