import React, { useEffect, useState } from 'react';
import {
  DynamicComponentRenderer,
  IDynamicComponentRendererProps,
} from '../DynamicComponentRenderer/DynamicComponentRenderer.js';
import { Box } from '@mui/material';
import { IConstructObjectParameters, constructObject, genericHandlerFunctions } from '@uncefact/untp-ri-services';

export interface ILocalStorageLoaderProps {
  onChange: (data: any) => void;
  storageKey: string;
  nestedComponents: Array<
    IDynamicComponentRendererProps & {
      constructData?: IConstructObjectParameters;
    }
  >;
}

enum AllowNestedComponent {
  CheckBoxList = 'CheckBoxList',
  JsonForm = 'JsonForm',
}

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
        "constructData": {
          "mappingFields": [
            {
              "sourcePath": "/vc/credentialSubject/product/itemIdentifiers/0/identifierValue",
              "destinationPath": "/transaction/identifier"
            },
            {
              "sourcePath": "/vc/credentialSubject/product/itemIdentifiers/0/identifierValue",
              "destinationPath": "/itemList/index/name"
            },
            {
              "sourcePath": "/linkResolver",
              "destinationPath": "/itemList/index/itemID"
            }
          ],
          "dummyFields": [
            {
              "path": "/eventType",
              "data": "transaction"
            },
            {
              "path": "/actionCode",
              "data": "observe"
            }
          ],
          "generationFields": [
            {
              "path": "/transaction/identifier",
              "handler": "generateIdWithSerialNumber"
            },
            {
              "path": "/eventTime",
              "handler": "generateCurrentDatetime"
            },
            {
              "path": "/eventID",
              "handler": "generateUUID"
            }
          ]
        }
      }
 *  ],
 * 
 * <LocalStorageLoader onChange={onChange} storageKey="key" nestedComponents={nestedComponents} />
 * 
 * With above example, constructData will be used to map, set and generate the data from local storage to the nested component.
 * The result of the mapping will be merged with the props.data of the nested component.
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
      if (component.constructData) {
        componentData = values.reduce((acc, value, index) => {
          return constructObject(acc, value, component.constructData!, index, { handlers: genericHandlerFunctions });
        }, componentData);
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
