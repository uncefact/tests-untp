import React, { useEffect, useState } from 'react';
import {
  DynamicComponentRenderer,
  IDynamicComponentRendererProps,
} from '../DynamicComponentRenderer/DynamicComponentRenderer.js';
import { Box } from '@mui/material';
import JSONPointer from 'jsonpointer';

interface IMappingField {
  sourcePath: string;
  destinationPath: string;
}

export interface ILocalStorageLoaderProps {
  onChange: (data: any) => void;
  storageKey: string;
  nestedComponents: Array<
    IDynamicComponentRendererProps & {
      constructData?: IMappingField[];
    }
  >;
}

enum AllowNestedComponent {
  CheckBoxList = 'CheckBoxList',
  JsonForm = 'JsonForm',
}
const allowedIndexKeys = ['i', 'index'];

/**
 * LocalStorageLoader component that will load data from local storage and pass it to nested components
 * 
 * @param ILocalStorageLoaderProps
 * @returns React.FC
 * 
 * @example
 * const nestedComponents = [
 *    {
        "name": "JsonForm",
        "type": "EntryData",
        "props": {},
        "constructData": [
          {
            "sourcePath": "/vc/credentialSubject/product/itemIdentifiers/0/identifierValue",
            "destinationPath": "/itemList/index/name"
          },
          {
            "sourcePath": "/linkResolver",
            "destinationPath": "/itemList/index/itemID"
          }
        ]
      }
 *  ],
 * 
 * <LocalStorageLoader onChange={onChange} storageKey="key" nestedComponents={nestedComponents} />
 * 
 * With above example, constructData will be used to map the data from local storage to the nested component with the given sourcePath and destinationPath.
 * The result of the mapping will be merge with the props.data of the nested component, and the result of mapping will be {itemList: [{name: 'valueOfIdentifierValue', itemID: 'valueOfLinkResolver'}]
 */

export const LocalStorageLoader = ({ onChange, storageKey, nestedComponents }: ILocalStorageLoaderProps) => {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    const storedData = localStorage.getItem(storageKey);
    if (storedData) {
      setData(JSON.parse(storedData));
    }
  }, [storageKey]);

  const renderDynamicComponent = () => {
    return nestedComponents.map((component, index) => {
      if (!(Object.values(AllowNestedComponent) as string[]).includes(component.name)) {
        return null;
      }
      let componentData = component.props.data || {};

      const values: any[] = Object.values(data);
      if (component.constructData && component.constructData.length > 0) {
        values.forEach((value, index) => {
          component.constructData?.forEach(({ sourcePath, destinationPath }) => {
            const destinationIndex = destinationPath.split('/').findIndex((key) => allowedIndexKeys.includes(key));
            const headDestinationPath = destinationPath.split('/').slice(0, destinationIndex).join('/');
            const tailDestinationPath = destinationPath
              .split('/')
              .slice(destinationIndex + 1)
              .join('/');

            const sourceValue = JSONPointer.get(value, sourcePath);
            JSONPointer.set(componentData, `${headDestinationPath}/${index}/${tailDestinationPath}`, sourceValue);
          });
        });
      } else {
        componentData = { ...componentData, ...data };
      }

      const props = {
        ...component.props,
        data: componentData,
        onChange,
      };

      return <DynamicComponentRenderer key={index} name={component.name} type={component.type} props={props} />;
    });
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {data ? renderDynamicComponent() : null}
    </Box>
  );
};
