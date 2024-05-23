import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QRCodeScannerDialogButton } from '../build/components/QRCodeScannerDialogButton/QRCodeScannerDialogButton';

const meta: any = {
  title: 'Scan QR Code Dialog Button',
  component: QRCodeScannerDialogButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof QRCodeScannerDialogButton>;

export default meta;
type Story = StoryObj<typeof meta>;



export const Default: Story = {
  args: { fetchDataFromScanQR: () => {} },
  decorators: [(Story) => <Story />],
};
