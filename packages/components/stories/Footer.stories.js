import React from 'react';
import { Footer } from '../src/components/Footer';

export default {
  title: 'Footer',
  component: Footer,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};


export const Default = {
  args: {},
  decorators: [
    (Story) => (
      <div style={{ minWidth: '1000px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
