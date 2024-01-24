export const schema = {
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

export const uischema = {
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

export const initialData = {
  string: 'This is a string',
  boolean: true,
};
