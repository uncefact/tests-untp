import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Scanner } from '../src/components/Scanner';

const meta = {
  title: 'Scanner',
  component: Scanner,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof Scanner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    fps: 10,
    disableFlip: false,
    qrCodeSuccessCallback: (decodedText: string) => console.log(`Scanned QR Code: ${decodedText}`),
    qrCodeErrorCallback: (error: unknown) => console.log('Failed to scanning code', error),
  },
  decorators: [(Story) => <Story />],
};
