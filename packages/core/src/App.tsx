import React, { Component } from 'react';
import { GenericFeature } from './components/GenericFeature';
import { ComponentType, IDynamicComponentRendererProps } from './components/GenericFeature/DynamicComponentRenderer';

function App() {
  const componentsData: IDynamicComponentRendererProps[] = [
    {
      name: 'JsonForm',
      type: 'EntryData' as ComponentType,
      props: {},
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
      parameters: [],
    },
  ];

  return (
    <div className='App'>
      <GenericFeature components={componentsData} services={services} />
    </div>
  );
}

export default App;
