export const schema = {
  type: 'object',
  properties: {
    name: {
      type: 'string',
    },
    vegetarian: {
      type: 'boolean',
    },
  },
};

export const uiSchema = {
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

export const initialData = {
  name: 'James A. Fernandes',
  vegetarian: true,
};
