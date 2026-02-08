/**
* @example 
* import { ComponentType, IDynamicComponentRendererProps } from './components/GenericFeature/DynamicComponentRenderer';
* 
* interface IService {
*  (arg1: any, ...args: any[]): any;
* }
* export const logService: IService = (arg1: any, ...args: any[]): any => {
*  console.log(arg1);
*  console.log(args);
*  return arg1;
* };
*
* export const logServiceTwo: IService = (arg1: any, ...args: any[]): any  => {
*  console.log(arg1);
*  return args;
* };

* function Example() {
*   const [jsonFormData, setJsonFormData] = React.useState();
*   const componentsData: IDynamicComponentRendererProps[] = [
*     {
*       name: 'JsonForm', // import from @mock-app/components
*       type: 'EntryData' as ComponentType,
*       props: {
*         schema: {
*           type: 'object',
*           properties: {
*             name: {
*               type: 'string',
*             },
*             vegetarian: {
*               type: 'boolean',
*             },
*           },
*         },
*         onChange: (value: any) => {
*           setJsonFormData(value.data);
*         },
*         uiSchema: {
*           type: 'VerticalLayout',
*           elements: [
*             {
*               type: 'Control',
*               scope: '#/properties/name',
*            },
*             {
*               type: 'Control',
*               scope: '#/properties/vegetarian',
*             },
*          ],
*         },
*         data: {},
*         className: '',
*       },
*     },
*     {
*       name: 'Button',
*       type: 'Submit' as ComponentType,
*       props: {},
*     },
*  ];
*
*    const services = [
*    {
*      name: 'logService',
*      parameters: [jsonFormData],
*    },
*    {
*      name: 'logServiceTwo',
*      parameters: [],
*    },
*  ];
* return (
*    <div className='example'>
*      <GenericFeature components={componentsData} services={services} />
*    </div>
*    );
*  }
*/

import React from 'react';
import * as services from '@uncefact/untp-ri-services';
// import * as events from '@mock-app/events';
import {
  toastMessage,
  Status,
  ComponentType,
  DynamicComponentRenderer,
  IDynamicComponentRendererProps,
} from '@mock-app/components';

type ServiceFunction = (...args: unknown[]) => unknown | Promise<unknown>;

export interface IServiceDefinition {
  name: string;
  parameters: Record<string, object | string>[];
}

export interface IGenericFeatureProps {
  components: IDynamicComponentRendererProps[];
  services: IServiceDefinition[];
}

const getService = (name: string): ServiceFunction => {
  const serviceName = name as keyof typeof services;
  if (typeof services[serviceName] !== 'undefined') {
    return services[serviceName] as ServiceFunction;
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
  const [state, setState] = React.useState<unknown[]>([]);
  const [result, setResult] = React.useState<unknown>();
  const props: Record<string, object> = {};

  const executeServices = async (services: IServiceDefinition[], parameters: unknown[]) => {
    const [result] = await services.reduce(async (previousResult: unknown[] | Promise<unknown[]>, currentService) => {
      const prevResult = await previousResult;
      const service: ServiceFunction = getService(currentService.name);
      const params = [...prevResult, ...currentService.parameters];
      const result: unknown = await service(...params);
      return [result];
    }, parameters);
    return result;
  };

  return (
    <div>
      {components.map((component, index) => {
        const type = component.type;
        switch (type) {
          case ComponentType.EntryData:
            // unknown is used to flexibilize the type of the value, since it can be any type
            props.onChange = (value: unknown) => {
              setState((s) => {
                s[index] = value;
                return s;
              });
            };
            break;
          case ComponentType.Submit:
            props.onClick = async (handler: (args: unknown) => void) => {
              try {
                const result = await executeServices(services, state);

                handler(result);
                setResult(result);
                toastMessage({ status: Status.success, message: 'Action Successful' });
              } catch (error) {
                if (error && typeof error === 'object' && 'message' in error) {
                  console.log(error.message);
                }
                toastMessage({ status: Status.error, message: 'Something went wrong' });
              }
            };
            break;
          case ComponentType.Result:
            if (result) {
              props.data = result as object;
            }
            break;
          default:
            break;
        }

        if (type === ComponentType.Result && !result) {
          return null;
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
