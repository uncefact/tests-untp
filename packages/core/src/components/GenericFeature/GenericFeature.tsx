import React from 'react';
import * as services from '@mock-app/services';
// import * as events from '@mock-app/events';
import { ComponentType, DynamicComponentRenderer, IDynamicComponentRendererProps } from './DynamicComponentRenderer';

export interface IServiceDefinition {
  name: string;
  parameters: any[];
}

export interface IGenericFeatureProps {
  components: IDynamicComponentRendererProps[];
  services: IServiceDefinition[];
}

const getService = (name: string) => {
  const serviceName = name as keyof typeof services;
  if (typeof services[serviceName] !== 'undefined') {
    return services[serviceName];
  }
  // const eventName = name as keyof typeof events;
  // if (typeof events[eventName] !== 'undefined') {
  //   return events[eventName];
  // }
  throw new Error(`Service or event ${name} not found`);
};

/**
 *
 * @param param0
 * @returns
 */
export const GenericFeature: React.FC<IGenericFeatureProps> = ({ components, services }: IGenericFeatureProps) => {
  const [state, setState] = React.useState<any[]>([]);
  const props: Record<string, any> = {};

  const executeServices = async (services: IServiceDefinition[], parameters: any[]) => {
    return services.reduce(async (previousResult: any[] | Promise<any[]>, currentService) => {
      const prevResult = await previousResult;
      const service: any = getService(currentService.name);
      const params = [...prevResult, ...currentService.parameters];
      const result: any = service(...params);
      return [result];
    }, parameters);
  };

  return (
    <div>
      {components.map((component, index) => {
        const type = component.type;
        switch (type) {
          case ComponentType.EntryData:
            props.onChange = (value: string) => {
              setState((s) => {
                s[index] = value;
                return s;
              });
            };
            break;
          case ComponentType.Submit:
            props.onClick = async () => {
              await executeServices(services, state);
            };
            break;
          default:
            break;
        }

        return (
          <DynamicComponentRenderer
            key={index}
            name={component.name}
            type={component.type}
            props={{ ...props, ...component.props }}
          />
        );
      })}
    </div>
  );
};
