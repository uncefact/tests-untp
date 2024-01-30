import React, { useEffect, useState } from 'react';
import * as components from '@mock-app/components';

export enum ComponentType {
  EntryData = 'EntryData',
  Void = 'Void',
  Submit = 'Submit',
}

/**
 * name: The name of the component to render
 * props: The props to pass to the component
 */
export interface IDynamicComponentRendererProps {
  name: string;
  type: ComponentType;
  props: Record<string, any>;
}

/**
 * Dynamic component renderer that will render a component is defined in the components package @mock-app/components to allow for dynamic loading of components
 * @param DynamicComponentProps
 * @returns React.FC
 */
export const DynamicComponentRenderer: React.FC<IDynamicComponentRendererProps> = ({
  name,
  props,
}: IDynamicComponentRendererProps) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);

  useEffect(() => {
    // Dynamically load the component from the components package
    const componentName = name as keyof typeof components;
    if (typeof components[componentName] !== 'undefined') {
      setComponent(() => components[componentName]);
    }
  }, [name]);

  return Component ? <Component {...props} /> : null;
};
