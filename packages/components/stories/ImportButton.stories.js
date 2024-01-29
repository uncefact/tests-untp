import React from 'react';

import { ImportButton } from '../src/components/ImportButton';

export default {
  title: 'ImportButton',
  component: ImportButton,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
};

export const Default = {
  args: {
    buttonText: 'Import',
    onChange: (data) => console.log(data)
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
