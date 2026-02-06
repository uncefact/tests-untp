import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { Header } from '../src/components/Header';

const meta = {
  title: 'Header',
  component: Header,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    logoTitle: 'Logo',
    logoTitleColor: '#000',
    backgroundColor: '#fff',
    routerLinks: [
      { title: 'Menu 1', path: '/menu-1' },
      { title: 'Menu 2', path: '/menu-2' },
      { title: 'Menu 3', path: '/menu-3' },
    ],
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
