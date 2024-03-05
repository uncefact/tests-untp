import React from 'react';
import { GenericFeature } from '../components/GenericFeature';
import { IDynamicComponentRendererProps } from '../components/GenericFeature/DynamicComponentRenderer';
import { IServiceDefinition } from '../components/GenericFeature/GenericFeature';

export interface IGenericFeatureProps {
  componentsData: IDynamicComponentRendererProps[];
  services: IServiceDefinition[];
}

const GenericPage = ({ componentsData, services, ...props }: IGenericFeatureProps) => {
  return (
    <main {...props}>
      <GenericFeature components={componentsData} services={services} />
    </main>
  );
};

export default GenericPage;
