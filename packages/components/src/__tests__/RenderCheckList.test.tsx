import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RenderCheckList } from '../components/RenderCheckList/RenderCheckList';
import * as DynamicComponentRendererComponent from '../components/DynamicComponentRenderer/DynamicComponentRenderer';
import { ImportButton } from '../components/ImportButton/ImportButton';

// Mocking the DynamicComponentRenderer module
jest.mock('../components/DynamicComponentRenderer/DynamicComponentRenderer', () => ({
  IDynamicComponentRendererProps: jest.fn(),
  ComponentType: jest.fn(),
  DynamicComponentRenderer: jest.fn(),
}));

// Function to load JSON file content
const loadJsonFile = (file: File): Promise<object> => {
  return new Promise((resolve) => {
    const fileReader = new FileReader();
    fileReader.onload = (event) => {
      const fileContent = event?.target?.result;
      const fileContentObject = JSON.parse(fileContent as string);
      resolve(fileContentObject);
    };
    fileReader.readAsText(file);
  });
};

/**
 * Test suite for the RenderCheckList component
 */
describe('render RenderCheckList component', () => {
  const checkBoxLabel = 'checkBoxLabel';
  const requiredFields = ['requiredField1'];
  const nestedComponent = {
    name: 'ImportButton',
    type: 'EntryData',
    props: { label: 'Import JSON' },
  } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
  const nestedComponents = [nestedComponent];
  const onChange = jest.fn();

  /**
   * Test case to check if the RenderCheckList component renders without crashing
   */
  it('Should render without crashing', () => {
    let componentError: any;
    try {
      render(
        <RenderCheckList
          checkBoxLabel={checkBoxLabel}
          requiredFields={requiredFields}
          onChange={onChange}
          nestedComponents={nestedComponents}
        />,
      );
    } catch (error) {
      componentError = error;
    }

    expect(componentError).toBeUndefined();
  });

  /**
   * Test case to check if the ImportButton component is displayed when "nestedComponents" prop has items
   */
  it('Should display an ImportButton component when "nestedComponents" prop has items', () => {
    // Simulating code: Mocking the DynamicComponentRenderer component to return an ImportButton
    jest
      .spyOn(DynamicComponentRendererComponent, 'DynamicComponentRenderer')
      .mockImplementation(() => <ImportButton label='Import JSON' onChange={(data) => {}} />);

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFields={requiredFields}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );
    const importButton = screen.getByText('Import JSON');

    expect(importButton).not.toBeNull();
  });

  /**
   * Test case to check if the CheckboxList component is not displayed when renderCheckboxList state is empty
   */
  it('Should not display a CheckboxList component when renderCheckboxList state is empty', () => {
    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFields={requiredFields}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );
    const checkboxList = screen.queryByLabelText(checkBoxLabel);

    expect(checkboxList).toBeNull();
  });

  /**
   * Test case to check if DynamicComponentRenderer components are not rendered for items not included in the AllowNestedComponent enum
   */
  it('Should not render DynamicComponentRenderer components for items not included in the AllowNestedComponent enum', () => {
    // Simulating code: Creating a nested component with an invalid name
    const nestedComponent = {
      name: 'InvalidComponent',
      type: 'EntryData',
      props: { label: 'Import JSON' },
    } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
    const nestedComponents = [nestedComponent];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFields={requiredFields}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );
    const importButton = screen.queryByText('Import JSON');

    expect(importButton).toBeNull();
  });

  /**
   * Test case to check if the handleFileUpload function is called correctly when the onChange prop of a DynamicComponentRenderer component is called
   */
  it('Should call the handleFileUpload correctly when the onChange prop of a DynamicComponentRenderer component is called', async () => {
    // Simulating code: Mocking the DynamicComponentRenderer component to return an ImportButton with a file input
    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      const fileArray = Array.from(files!);
      const fileContents = await Promise.all(fileArray.map((file: File) => loadJsonFile(file)));

      expect(fileContents).toEqual([{steelID: 'steelID-987654321'}]);
    };
    const ImportButtonMock = <input data-testid="file-input" type='file' accept='.json' hidden onChange={handleFileUpload} multiple />;
    jest.spyOn(DynamicComponentRendererComponent, 'DynamicComponentRenderer').mockReturnValueOnce(ImportButtonMock);
    const jsonFile = new File([JSON.stringify({steelID: 'steelID-987654321'})], 'vc.json', { type: 'application/json' });

    render(<RenderCheckList checkBoxLabel={checkBoxLabel} requiredFields={requiredFields} onChange={onChange} nestedComponents={nestedComponents} />);

    const importButton = screen.getByTestId('file-input');
    // Fire the change event on the importButton element
    fireEvent.change(importButton, { target: { files: [jsonFile] } });
  });
});
