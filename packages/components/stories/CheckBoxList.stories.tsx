import React from 'react';
import type { Meta, StoryObj } from '@storybook/react-webpack5';
import { CheckBoxList } from '../src/components/CheckBoxList/CheckBoxList';

const meta: any = {
  title: 'CheckBoxList',
  component: CheckBoxList,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof CheckBoxList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: 'CheckBoxList',
    data: [
      { label: 'Test label 1', value: 'Test value 1' },
      { label: 'Test label 2', value: 'Test value 2' },
      { label: 'Test label 3', value: 'Test value 3' },
    ],
    onChangeCheckBox: (data) => console.log(data),
  },
  decorators: [
    (Story) => (
      <div style={{ minWidth: '500px', height: '20vh' }}>
        <Story />
      </div>
    ),
  ],
};
