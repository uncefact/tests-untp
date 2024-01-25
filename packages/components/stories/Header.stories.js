import React from 'react';

import { Header } from '../src/components/Header';

export default {
  title: 'Header',
  component: Header,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};

export const Default = {
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
