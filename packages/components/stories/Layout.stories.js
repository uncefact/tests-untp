import React from 'react';
import { Typography } from '@mui/material';

import { Layout } from '../src/components/Layout';

export default {
  title: 'Layout',
  component: Layout,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};

export const Default = {
  args: {
    children: <Typography>Main layout here</Typography>,
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '1000px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
