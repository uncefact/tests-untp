import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { JsonForm } from '../src/components/json-form/JsonForm';

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
    string: {
      type: 'string',
    },
    boolean: {
      type: 'boolean',
      description: 'Boolean description as a tooltip',
    },
  },
};

const uiSchema = {
  type: 'VerticalLayout',
  elements: [
    {
      type: 'Control',
      scope: '#/properties/string',
    },
    {
      type: 'Control',
      scope: '#/properties/boolean',
    },
  ],
};

const initialData = {
  string: 'Hello',
  boolean: false,
};

const jsonData = {
  schema,
  uiSchema,
  initialData,
  onChangeJsonSchemaForm: () => {},
};

export const Default: Story = {
  args: { jsonData },
  decorators: [(Story) => <Story />],
};
