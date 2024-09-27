import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { RenderCheckList } from '../components/RenderCheckList/RenderCheckList';
import * as DynamicComponentRendererComponent from '../components/DynamicComponentRenderer/DynamicComponentRenderer';

jest.mock('../components/ConformityCredential/index.ts', () => ({}));

describe('render RenderCheckList component', () => {
  const checkBoxLabel = 'checkBoxLabel';
  const requiredFieldPath = '/requiredField1';
  const nestedComponents = [
    {
      name: 'ImportButton',
      type: 'EntryData',
      props: { label: 'Import JSON' },
    } as DynamicComponentRendererComponent.IDynamicComponentRendererProps,
  ];
  const onChange = jest.fn();

  it('Should render without crashing', () => {
    // Declare a variable to hold any potential error from the component rendering
    let componentError: any;

    try {
      render(
        <RenderCheckList
          checkBoxLabel={checkBoxLabel}
          requiredFieldPath={requiredFieldPath}
          onChange={onChange}
          nestedComponents={nestedComponents}
        />,
      );
    } catch (error) {
      // If an error is thrown during rendering, catch it and assign it to componentError
      componentError = error;
    }

    // Assert that no error was thrown during rendering (componentError should be undefined)
    expect(componentError).toBeUndefined();
  });

  it('Should display an ImportButton component when "nestedComponents" prop have ImportButton item', () => {
    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );

    // This assumes that the ImportButton component displays this text
    const importButton = screen.getByText('Import JSON');

    // Assert that the element was found in the document
    expect(importButton).toBeInTheDocument();
  });

  it('Should not display a CheckboxList component when renderCheckboxList state is empty', () => {
    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );

    // Use screen.queryByLabelText to find an element with the label text equal to checkBoxLabel
    const checkboxList = screen.queryByLabelText(checkBoxLabel);

    // Assert that the element was not found in the document
    expect(checkboxList).toBeNull();
  });

  it('Should not render DynamicComponentRenderer components for items not included in the AllowNestedComponent enum', () => {
    const nestedComponent = {
      name: 'InvalidComponent',
      type: 'EntryData',
      props: { label: 'Import JSON' },
    } as DynamicComponentRendererComponent.IDynamicComponentRendererProps;
    const nestedComponents = [nestedComponent];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );
    // Try to find an element with the text 'Import JSON'
    const importButton = screen.queryByText('Import JSON');

    // Assert that the element was not found in the document
    expect(importButton).toBeNull();
  });

  it('Should render the checkbox when the onChange prop of a DynamicComponentRenderer component is called', async () => {
    const jsonFile = new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc.json', {
      type: 'application/json',
    });

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with a JSON file
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: [jsonFile] } });
    });

    // Wait for the checkbox to appear and assert that it's checked after being clicked
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      expect(checkBox1).not.toBeChecked();

      checkBox1.click();
      expect(checkBox1).toBeChecked();
    });
  });

  it('Should call the onChange prop with the correct data when the onChange prop of a DynamicComponentRenderer component is called', async () => {
    let checkBoxListData: any = [];
    const jsonFile = new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc.json', {
      type: 'application/json',
    });
    const onChangeCheckBoxList = (data: object) => (checkBoxListData = data);

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChangeCheckBoxList}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with a JSON file
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: [jsonFile] } });
    });

    // Wait for the checkbox to appear, click it, and assert that the onChange prop was called with the correct data
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      checkBox1.click();

      expect(checkBoxListData).toEqual([{ label: 'label-test-1', value: { requiredField1: 'label-test-1' } }]);
    });
  });

  it('Should call the onChange prop with the selected items when multiple checkbox are checked', async () => {
    const importJsonFiles = [
      new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc1.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-2' })], 'vc2.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-3' })], 'vc3.json', { type: 'application/json' }),
    ];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChange}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with multiple JSON files
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: importJsonFiles } });
    });

    // Wait for the checkboxes to appear, click them, and assert that they are checked
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      const checkBox2 = screen.getByLabelText('label-test-2');
      const checkBox3 = screen.getByLabelText('label-test-3');

      checkBox1.click();
      checkBox2.click();
      checkBox3.click();

      expect(checkBox1).toBeChecked();
      expect(checkBox2).toBeChecked();
      expect(checkBox3).toBeChecked();
    });
  });

  it("Should call the RenderCheckList's onChange function with checked item when a single checkbox is checked", async () => {
    let checkBoxListData: any = [];
    const onChangeCheckBoxList = (data: object) => (checkBoxListData = data);
    const importJsonFiles = [
      new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc1.json', { type: 'application/json' }),
    ];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChangeCheckBoxList}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with a JSON file
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: importJsonFiles } });
    });

    // Wait for the checkbox to appear, assert that it's not checked and the onChange prop was not called,
    // then click the checkbox and assert that it's checked and the onChange prop was called with the correct data
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      expect(checkBox1).not.toBeChecked();
      expect(checkBoxListData).toEqual([]);

      checkBox1.click();
      expect(checkBox1).toBeChecked();
      expect(checkBoxListData).toEqual([{ label: 'label-test-1', value: { requiredField1: 'label-test-1' } }]);
    });
  });

  it('Should update the state correctly when a checked checkbox is unchecked', async () => {
    let checkBoxListData: any = [];
    const onChangeCheckBoxList = (data: object) => (checkBoxListData = data);
    const importJsonFiles = [
      new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc1.json', { type: 'application/json' }),
    ];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChangeCheckBoxList}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with a JSON file
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: importJsonFiles } });
    });

    // Wait for the checkbox to appear, click it to check it, assert that it's checked and the onChange prop was called with the correct data,
    // then click it again to uncheck it and assert that it's not checked and the onChange prop was called with an empty array
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      checkBox1.click();
      expect(checkBox1).toBeChecked();
      expect(checkBoxListData).toEqual([{ label: 'label-test-1', value: { requiredField1: 'label-test-1' } }]);

      checkBox1.click();
      expect(checkBox1).not.toBeChecked();
      expect(checkBoxListData).toEqual([]);
    });
  });

  it("Should call the RenderCheckList's onChange function with checked item when multiple checkbox are checked", async () => {
    let checkBoxListData: any = [];
    const onChangeCheckBoxList = (data: object) => (checkBoxListData = data);
    const importJsonFiles = [
      new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc1.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-2' })], 'vc2.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-3' })], 'vc3.json', { type: 'application/json' }),
    ];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChangeCheckBoxList}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with multiple JSON files
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: importJsonFiles } });
    });

    // Wait for the checkboxes to appear, click them, and assert that they are checked and the onChange prop was called with the correct data
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      const checkBox2 = screen.getByLabelText('label-test-2');
      const checkBox3 = screen.getByLabelText('label-test-3');

      checkBox1.click();
      expect(checkBox1).toBeChecked();
      expect(checkBoxListData).toEqual([{ label: 'label-test-1', value: { requiredField1: 'label-test-1' } }]);

      checkBox2.click();
      expect(checkBox2).toBeChecked();
      expect(checkBoxListData).toEqual([
        { label: 'label-test-1', value: { requiredField1: 'label-test-1' } },
        { label: 'label-test-2', value: { requiredField1: 'label-test-2' } },
      ]);

      checkBox3.click();
      expect(checkBox3).toBeChecked();
      expect(checkBoxListData).toEqual([
        { label: 'label-test-1', value: { requiredField1: 'label-test-1' } },
        { label: 'label-test-2', value: { requiredField1: 'label-test-2' } },
        { label: 'label-test-3', value: { requiredField1: 'label-test-3' } },
      ]);
    });
  });

  it('Should update the state correctly when multiple checked checkbox are unchecked', async () => {
    let checkBoxListData: any = [];
    const onChangeCheckBoxList = (data: object) => (checkBoxListData = data);
    const importJsonFiles = [
      new File([JSON.stringify({ requiredField1: 'label-test-1' })], 'vc1.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-2' })], 'vc2.json', { type: 'application/json' }),
      new File([JSON.stringify({ requiredField1: 'label-test-3' })], 'vc3.json', { type: 'application/json' }),
    ];

    render(
      <RenderCheckList
        checkBoxLabel={checkBoxLabel}
        requiredFieldPath={requiredFieldPath}
        onChange={onChangeCheckBoxList}
        nestedComponents={nestedComponents}
      />,
    );

    // Find the import button and simulate a change event with multiple JSON files
    const importButton = screen.getByTestId('file-input');
    act(() => {
      fireEvent.change(importButton, { target: { files: importJsonFiles } });
    });

    // Wait for the checkboxes to appear, assert that they are unchecked and the state is empty,
    // click on them to check them, assert that they are checked and the state is updated correctly,
    // then uncheck some of them and assert that they are unchecked and the state is updated correctly
    await waitFor(() => {
      const checkBox1 = screen.getByLabelText('label-test-1');
      const checkBox2 = screen.getByLabelText('label-test-2');
      const checkBox3 = screen.getByLabelText('label-test-3');

      // Assert that all checkboxes are unchecked and the state is empty
      expect(checkBox1).not.toBeChecked();
      expect(checkBox2).not.toBeChecked();
      expect(checkBox3).not.toBeChecked();
      expect(checkBoxListData).toEqual([]);

      // Click on all checkboxes to check them
      checkBox1.click();
      checkBox2.click();
      checkBox3.click();

      // Assert that all checkboxes are checked and the state is updated correctly
      expect(checkBox1).toBeChecked();
      expect(checkBox2).toBeChecked();
      expect(checkBox3).toBeChecked();
      expect(checkBoxListData).toEqual([
        { label: 'label-test-1', value: { requiredField1: 'label-test-1' } },
        { label: 'label-test-2', value: { requiredField1: 'label-test-2' } },
        { label: 'label-test-3', value: { requiredField1: 'label-test-3' } },
      ]);

      // Uncheck checkbox 1 and 2, and assert that they are unchecked and the state is updated correctly
      checkBox1.click();
      checkBox2.click();
      expect(checkBox1).not.toBeChecked();
      expect(checkBox2).not.toBeChecked();
      expect(checkBox3).toBeChecked();
      expect(checkBoxListData).toEqual([{ label: 'label-test-3', value: { requiredField1: 'label-test-3' } }]);
    });
  });
});
