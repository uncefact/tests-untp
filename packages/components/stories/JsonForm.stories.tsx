import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { JsonForm } from '../src/components/JsonForm/JsonForm';

const meta: any = {
  title: 'Json Form',
  component: JsonForm,
  parameters: { layout: 'centered' },
  tags: ['autodocs'],
  argTypes: {},
} satisfies Meta<typeof JsonForm>;

export default meta;
type Story = StoryObj<typeof meta>;

const schema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
      description: 'Please enter your name',
    },
    vegetarian: {
      type: 'boolean',
    },
  },
};

const uiSchema = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/name',
    },
    {
      type: 'Control',
      scope: '#/properties/vegetarian',
    },
  ],
};

const initialData = {
  name: 'John Doe',
  vegetarian: false,
};

export const Default: Story = {
  args: { schema, uiSchema, initialData, onChange: () => {} },
  decorators: [(Story) => <Story />],
};
