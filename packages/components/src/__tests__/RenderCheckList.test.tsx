import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RenderCheckList } from '../components/RenderCheckList/RenderCheckList';
// import { IDynamicComponentRendererProps, DynamicComponentRenderer } from '../components/DynamicComponentRenderer/DynamicComponentRenderer';
import * as DynamicComponentRendererComponent from '../components/DynamicComponentRenderer/DynamicComponentRenderer';
import { ImportButton } from '../components/ImportButton/ImportButton';

jest.mock('../components/DynamicComponentRenderer/DynamicComponentRenderer', () => ({
  IDynamicComponentRendererProps: jest.fn(),
  ComponentType: jest.fn(),
  DynamicComponentRenderer: jest.fn(),
}));

describe('render RenderCheckList component', () => {
  const checkBoxLabel = 'checkBoxLabel';
  const requiredFields = ['requiredField1'];
  const nestedComponent = { name: 'ImportButton', type: 'EntryData', props: { label: 'Import JSON'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  const nestedComponents = [nestedComponent];
  const onChange = jest.fn();

  it('Should render without crashing', () => {
    let componentError: any;
    try {
      render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    } catch (error) {
      componentError = error;
    }

    expect(componentError).toBeUndefined();
  });

  it('Should display a ImportButton component when "nestedComponents" props has items', () => {
    jest.spyOn(DynamicComponentRendererComponent, 'DynamicComponentRenderer').mockImplementation(() => <ImportButton label='Import JSON' onChange={(data) => { }}/>);

    render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    const importButton = screen.getByText('Import JSON');

    expect(importButton).not.toBeNull();
  });

  it('Should not display a CheckboxList component when renderCheckboxList state is empty', () => {
    render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    const checkboxList = screen.queryByLabelText(checkBoxLabel);

    expect(checkboxList).toBeNull();
  });

  it('Should not render DynamicComponentRenderer components for items not included in the AllowNestedComponent enum', () => {
    const nestedComponent = { name: 'InvalidComponent', type: 'EntryData', props: { label: 'Import JSON'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
    const nestedComponents = [nestedComponent];

    render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    const importButton = screen.queryByText('Import JSON');

    expect(importButton).toBeNull();
  });

  // it('Should update the renderCheckboxList state correctly when the onChange prop of a DynamicComponentRenderer component is called', async () => {
  //   const nestedComponent = { name: 'ImportButton', type: 'EntryData', props: { label: 'Import JSON'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  //   const nestedComponents = [nestedComponent];
  //   render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    
  //   // Simulate the onChange event of the DynamicComponentRenderer component
  //   fireEvent.change(screen.getByLabelText('Import JSON'), { target: { value: 'Test Value' } });
    
  //   // Wait for the state update to occur
  //   await waitFor(() => {
  //     expect(onChange).toHaveBeenCalledWith({ 'ImportButton': 'Test Value' });
  //   });
  // });

  // it('Should handle nestedComponents prop with multiple items', () => {
  //   const nestedComponent1 = { name: 'ImportButton', type: 'EntryData', props: { label: 'Import JSON 1'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  //   const nestedComponent2 = { name: 'QRCodeScannerDialogButton', type: 'EntryData', props: { label: 'Scan QR Code' } } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  //   const nestedComponents = [nestedComponent1, nestedComponent2];
  //   render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    
  //   const importButton = screen.getByText('Import JSON 1');
  //   const qrCodeScannerButton = screen.getByText('Scan QR Code');
    
  //   expect(importButton).not.toBeNull();
  //   expect(qrCodeScannerButton).not.toBeNull();
  // });

  // it('Should handle nestedComponents prop with no items', () => {
  //   const nestedComponents: DynamicComponentRendererComponent.IDynamicComponentRendererProps[] = [];
  //   render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    
  //   const importButton = screen.queryByText('Import JSON');
  //   expect(importButton).toBeNull();
  // });

  // it('Should throw an error when requiredFields prop is not provided', () => {
  //   const nestedComponents: DynamicComponentRendererComponent.IDynamicComponentRendererProps[] = [];
  //   const invalidRender = () => {
  //     render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
  //   };
  //   expect(invalidRender).toThrow('requiredFields prop is required');
  // });

  // it('Should throw an error when onChange prop is not provided', () => {
  //   const nestedComponents: DynamicComponentRendererComponent.IDynamicComponentRendererProps[] = [];
  //   const invalidRender = () => {
  //     render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} nestedComponents={nestedComponents} onChange={onChange} />);
  //   };
  //   expect(invalidRender).toThrow('onChange prop is required');
  // });

  // it('Should display the checkBoxLabel prop in the CheckboxList component', () => {
  //   render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    
  //   const checkboxList = screen.getByLabelText(checkBoxLabel);
  //   expect(checkboxList).not.toBeNull();
  // });

  // it('Should handle the case when the data passed to the onChange prop of a DynamicComponentRenderer component is an array', async () => {
  //   const nestedComponent = { name: 'ImportButton', type: 'EntryData', props: { label: 'Import JSON'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  //   const nestedComponents = [nestedComponent];
  //   render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    
  //   // Simulate the onChange event of the DynamicComponentRenderer component with an array value
  //   fireEvent.change(screen.getByLabelText('Import JSON'), { target: { value: ['Value 1', 'Value 2'] } });
    
  //   // Wait for the state update to occur
  //   await waitFor(() => {
  //     expect(onChange).toHaveBeenCalledWith({ 'ImportButton': ['Value 1', 'Value 2'] });
  //   });
  // });

  // it('Should update the renderCheckboxList state correctly when the onChange prop of a DynamicComponentRenderer component is called', async () => {
   
  // });

  // it('Should handle nestedComponents prop with multiple items', () => {
    // const checkBoxLabel = 'checkBoxLabel';
    // const requiredFields = ['requiredField1'];
    // const nestedComponent = { name: 'ImportButton', type: 'EntryData', props: { label: 'Import JSON'} } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
    // const nestedComponents = [nestedComponent];
    // const onChange = jest.fn();
    // const importedFiles: any[] = [];

    // jest.spyOn(DynamicComponentRendererComponent, 'DynamicComponentRenderer').mockImplementation(() => <ImportButton label='Import JSON' onChange={(data) => { 
    //   importedFiles.push(data);
    // }}/>);

    // render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);
    // const importButton = screen.getByText('Import JSON');
    // const json = {
    //   '@context': ['https://www.w3.org/2018/credentials/v1'],
    //   steelID: 'steelID-987654321',
    // };
    // const jsonFile = new File([JSON.stringify(json)], 'vc.json', { type: 'application/json' });
    // // simulate ulpoad event and wait until finish
    // await waitFor(() =>
    //   fireEvent.change(importButton, {
    //     target: { files: [jsonFile] },
    //   })
    // );

    // fireEvent.change(importButton, {
    //   target: { files: [jsonFile] },
    // });

    // expect(importedFiles).toEqual([{ label: 'Import JSON', value: 'Import JSON' }]);
  // });

  // it('Should handle nestedComponents prop with no items', () => {});

  // it('Should throw an error when requiredFields prop is not provided', () => {});

  // it('Should throw an error when onChange prop is not provided', () => {});

  // it('Should display the checkBoxLabel prop in the CheckboxList component', () => {});

  // it('Should handle the case when the data passed to the onChange prop of a DynamicComponentRenderer component is an array', () => {});

  // it('Should handle the case when the data passed to the onChange prop of a DynamicComponentRenderer component is an object', () => {});
});
