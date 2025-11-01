import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { RenderCheckList } from '../build/components/RenderCheckList/RenderCheckList';

const meta: any = {
  title: 'RenderCheckList',
  component: RenderCheckList,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof RenderCheckList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    checkBoxLabel: 'checkBoxLabel',
    requiredFields: ['test'],
    onChange: (data) => console.log(data),
    nestedComponents: [{
      name: 'ImportButton',
      type: 'EntryData',
      props: {}
    }]
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
