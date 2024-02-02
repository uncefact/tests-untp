import { ComponentType, IDynamicComponentRendererProps } from '../components/GenericFeature/DynamicComponentRenderer';

export const componentsData: IDynamicComponentRendererProps[] = [
  {
    name: 'JsonForm', // import from components in @mock-app/components
    type: ComponentType.EntryData,
    props: {
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          age: {
            type: 'number',
          },
        },
      },
      uiSchema: {
        type: 'Group',
        label: 'Information form',
        elements: [
          {
            type: 'Control',
            scope: '#/properties/name',
          },
          {
            type: 'Control',
            scope: '#/properties/age',
          },
        ],
      },
      initialData: {},
      className: 'json-form',
      style: { margin: 'auto', paddingTop: '160px', width: '40%' },
    },
  },
  {
    name: 'CustomButton',
    type: ComponentType.Submit,
    props: {
      style: { textAlign: 'center' },
    },
  },
];

export const services = [
  {
    name: 'getFormInfo',
    parameters: [],
  },
];
