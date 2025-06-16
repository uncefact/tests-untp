import React from 'react';
import { GenericFeature } from '../components/GenericFeature';
import { IServiceDefinition } from '../components/GenericFeature/GenericFeature';
import { ToastMessage, IDynamicComponentRendererProps } from '@mock-app/components';

export interface IGenericFeatureProps {
  componentsData: IDynamicComponentRendererProps[];
  services: IServiceDefinition[];
}

const GenericPage = ({ componentsData, services, ...props }: IGenericFeatureProps) => {
  return (
    <main {...props}>
      <ToastMessage />
      <GenericFeature components={componentsData} services={services} />
    </main>
  );
};

export default GenericPage;
