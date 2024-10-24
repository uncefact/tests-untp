import React, { useState } from 'react';
import { Box } from '@mui/material';
import { CheckBoxList, ICheckBoxes } from '../CheckBoxList/CheckBoxList.js';
import {
  DynamicComponentRenderer,
  IDynamicComponentRendererProps,
} from '../DynamicComponentRenderer/DynamicComponentRenderer.js';

export interface IRenderCheckList {
  checkBoxLabel?: string;
  nestedComponents: IDynamicComponentRendererProps[];
  onChange: (data: any) => void;
}

export enum AllowNestedComponent {
  ImportButton = 'ImportButton',
  QRCodeScannerDialogButton = 'QRCodeScannerDialogButton',
}

export const RenderCheckList = ({ checkBoxLabel, onChange, nestedComponents }: IRenderCheckList) => {
  const [checkBoxes, setCheckBoxes] = useState<ICheckBoxes>({});

  const handleOnChange = (data: object | object[]) => {
    if (!Array.isArray(data) && typeof data !== 'object') {
      return;
    }

    const uploadedFiles = [];
    if (Array.isArray(data)) {
      uploadedFiles.push(...data);
    } else if (typeof data === 'object') {
      uploadedFiles.push(data);
    }

    const validItems = uploadedFiles.reduce((acc, item) => {
      return { ...acc, ...item };
    }, {});

    return setCheckBoxes((prev) => ({ ...prev, ...validItems }));
  };

  const renderDynamicComponent = () => {
    return nestedComponents.map((component, index) => {
      if (!(Object.values(AllowNestedComponent) as string[]).includes(component.name)) {
        return null;
      }

      const props = {
        ...component.props,
        onChange: component.type === 'EntryData' ? handleOnChange : undefined,
      };

      return <DynamicComponentRenderer key={index} name={component.name} type={component.type} props={props} />;
    });
  };

  const renderCheckBoxes = () => {
    if (!Object.values(checkBoxes).length) {
      return null;
    }

    return <CheckBoxList label={checkBoxLabel} data={checkBoxes} onChange={onChange} />;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      {renderDynamicComponent()}
      {renderCheckBoxes()}
    </Box>
  );
};
