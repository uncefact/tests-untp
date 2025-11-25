import type { Meta, StoryObj } from '@storybook/react';
import { BackButton } from '../src/components/BackButton';
import { BrowserRouter } from 'react-router-dom';

const meta = {
  title: 'Back Button',
  component: BackButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
} satisfies Meta<typeof BackButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    children: <></>,
  },
  decorators: [
    (Story) => (
      <BrowserRouter>
        <Story />
      </BrowserRouter>
    ),
  ],
};
