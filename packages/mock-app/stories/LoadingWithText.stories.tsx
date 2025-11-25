import type { Meta, StoryObj } from '@storybook/react';
import { LoadingWithText } from '../src/components/LoadingWithText';

const meta = {
  title: 'Loading with text',
  component: LoadingWithText,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof LoadingWithText>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { text: 'Loading...' },
  decorators: [(Story) => <Story />],
};
