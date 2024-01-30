import React from 'react';
import { GenericFeature } from './components/GenericFeature';
import { ComponentType, IDynamicComponentRendererProps } from './components/GenericFeature/DynamicComponentRenderer';

function App() {
  const [jsonFormData, setJsonFormData] = React.useState();
  const componentsData: IDynamicComponentRendererProps[] = [
    {
      name: 'JsonForm',
      type: 'EntryData' as ComponentType,
      props: {
        schema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
            },
            vegetarian: {
              type: 'boolean',
            },
          },
        },
        onChange: (value: any) => {
          setJsonFormData(value.data);
        },
        uiSchema: {
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
        },
        initialData: {},
        className: '',
      },
    },
    {
      name: 'Button',
      type: 'Submit' as ComponentType,
      props: {},
    },
  ];

  const services = [
    {
      name: 'logService',
      parameters: [jsonFormData],
    },
  ];

  return (
    <div className='App'>
      <GenericFeature components={componentsData} services={services} />
    </div>
  );
}

export default App;
