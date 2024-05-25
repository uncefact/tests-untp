import React, { useState } from 'react';
import { Box } from '@mui/material';
import { CheckBoxList } from '../CheckBoxList/CheckBoxList.js';
import {
  DynamicComponentRenderer,
  IDynamicComponentRendererProps,
} from '../DynamicComponentRenderer/DynamicComponentRenderer.js';

export interface IRenderCheckList {
  checkBoxLabel?: string;
  requiredFields: string[];
  nestedComponents: IDynamicComponentRendererProps[];
  onChange: (data: object) => void;
}

export enum AllowNestedComponent {
  ImportButton = 'ImportButton',
  QRCodeScannerDialogButton = 'QRCodeScannerDialogButton',
}

export const RenderCheckList = ({ checkBoxLabel, requiredFields, onChange, nestedComponents }: IRenderCheckList) => {
  const [renderCheckBoxList, setRenderCheckBoxList] = useState<any[]>([]);
  const props: Record<string, any> = {};

  const getRequiredFieldValue = (jsonData: any, requiredFields: string[]) => {
    let requiredFieldValue = jsonData;
    for (const requiredField of requiredFields) {
      if (!requiredFieldValue[requiredField]) {
        return null;
      }

      requiredFieldValue = requiredFieldValue[requiredField];
    }

    return requiredFieldValue;
  };

  return (
    <Box
      sx={{
        paddingTop: '95px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {nestedComponents.map((component, index) => {
        if (!(Object.values(AllowNestedComponent) as string[]).includes(component.name)) {
          return null;
        }

        switch (component.type) {
          case 'EntryData':
            // unknown is used to flexibilize the type of the value, since it can be any type
            props.onChange = (data: any) => {
              if (Array.isArray(data)) {
                const validItems = data.reduce((acc, item) => {
                  const requiredFieldValue = getRequiredFieldValue(item, requiredFields);
                  if (!requiredFieldValue) {
                    return acc;
                  }
                  const isAvailableItem = renderCheckBoxList.find((renderCheckBox: any) => renderCheckBox.label === requiredFieldValue);
                  if (isAvailableItem) {
                    return acc;
                  }

                  return [...acc, { label: requiredFieldValue, value: item }];
                }, []);

                return setRenderCheckBoxList((prev) => [...prev, ...validItems]);
              }

              // Check the object data is valid
              const requiredFieldValue = getRequiredFieldValue(data, requiredFields);
              if (!requiredFieldValue) {
                return null;
              }
              
              const validData = { label: requiredFieldValue, value: data };
              setRenderCheckBoxList((prev) => [...prev, validData]);
            };

            break;
            // case ComponentType.Submit:
            //   props.onClick = async () => {
            //     try {
            //       await executeServices(services, state);
            //       toastMessage({ status: Status.success, message: 'Submit success' });
            //     } catch (error: any) {
            //       toastMessage({ status: Status.error, message: error.message });
            //     }
            //   };
            // break;
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
      {renderCheckBoxList.length > 0 && (
        <CheckBoxList label={checkBoxLabel} data={renderCheckBoxList} onChange={onChange} />
      )}
    </Box>
  );
};
