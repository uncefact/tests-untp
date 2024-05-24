import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { CheckBoxList } from '../components/CheckBoxList/CheckBoxList';

describe('render CheckBoxList component', () => {
  const onChange = jest.fn();

  it('Should display a label passed as a prop', () => {
    const data = [{ label: 'label1', value: 'value1' }];

    render(<CheckBoxList data={data} onChange={onChange} />);
    const checkbox1 = screen.getByLabelText('label1');

    expect(checkbox1).not.toBeNull();
  });

  it('Should render a checkbox for each item in the data array', () => {
    const data = [
      { label: 'label1', value: 'value1' },
      { label: 'label2', value: 'value2' },
    ];

    render(<CheckBoxList data={data} onChange={onChange} />);
    const checkbox1 = screen.getByLabelText('label1');
    const checkbox2 = screen.getByLabelText('label2');

    expect(checkbox1).not.toBeNull();
    expect(checkbox2).not.toBeNull();
  });

  it('Should call onChange with the selected items when a checkbox is checked', () => {
    const data = [{ label: 'label1', value: 'value1' }];
    const onChangeCheckBoxList = (data: object[]) => {
      expect(data).toEqual([{ label: 'label1', value: 'value1' }]);
    };

    render(<CheckBoxList data={data} onChange={onChangeCheckBoxList} />);
    const checkbox1 = screen.getByLabelText('label1');
    fireEvent.click(checkbox1);

    expect(checkbox1).toBeChecked();
  });

  it('Should call onChange with the selected items when a checkbox is checked', () => {
    const data = [{ label: 'label1', value: 'value1' }];
    const onChangeCheckBoxList = (data: object[]) => {
      expect(data).toEqual([{ label: 'label1', value: 'value1' }]);
    };

    render(<CheckBoxList data={data} onChange={onChangeCheckBoxList} />);
    const checkbox1 = screen.getByLabelText('label1');
    fireEvent.click(checkbox1);

    expect(checkbox1).toBeChecked();
  });

  it('Should call onChange with the selected items when multiple checkbox are checked', () => {
    const data = [
      { label: 'label1', value: 'value1' },
      { label: 'label2', value: 'value2' },
      { label: 'label3', value: 'value3' },
    ];
    let CheckBoxListState: object[] = [];
    const onChangeCheckBoxList = (data: object[]) => {
      CheckBoxListState = data;
    };

    render(<CheckBoxList data={data} onChange={onChangeCheckBoxList} />);
    const checkbox1 = screen.getByLabelText('label1');
    const checkbox2 = screen.getByLabelText('label2');
    const checkbox3 = screen.getByLabelText('label3');

    // Check the first checkbox
    fireEvent.click(checkbox1);
    expect(checkbox1).toBeChecked();
    expect(checkbox2).not.toBeChecked();
    expect(checkbox3).not.toBeChecked();
    expect(CheckBoxListState).toEqual([
      { label: 'label1', value: 'value1' }
    ]);

    // Check the second checkbox
    fireEvent.click(checkbox2);
    expect(checkbox1).toBeChecked();
    expect(checkbox2).toBeChecked();
    expect(checkbox3).not.toBeChecked();
    expect(CheckBoxListState).toEqual([
      { label: 'label1', value: 'value1' },
      { label: 'label2', value: 'value2' },
    ]);

    // Check the third checkbox
    fireEvent.click(checkbox3);
    expect(checkbox1).toBeChecked();
    expect(checkbox2).toBeChecked();
    expect(checkbox3).toBeChecked();
    expect(CheckBoxListState).toEqual([
      { label: 'label1', value: 'value1' },
      { label: 'label2', value: 'value2' },
      { label: 'label3', value: 'value3' },
    ]);

  });

  it('Should update the state correctly when a checked checkbox is unchecked', () => {
    const data = [
      { label: 'label1', value: 'value1' },
      { label: 'label2', value: 'value2' },
    ];
    let CheckBoxListState: object[] = [];
    const onChangeCheckBoxList = (data: object[]) => {
      CheckBoxListState = data;
    };
    
    render(<CheckBoxList data={data} onChange={onChangeCheckBoxList} />);
    const checkbox1 = screen.getByLabelText('label1');
    const checkbox2 = screen.getByLabelText('label2');

    // Check the first checkbox
    fireEvent.click(checkbox1);
    expect(checkbox1).toBeChecked();
    expect(checkbox2).not.toBeChecked();
    expect(CheckBoxListState).toEqual([
      { label: 'label1', value: 'value1' }
    ]);

    // Uncheck the first checkbox
    fireEvent.click(checkbox1);
    expect(checkbox1).not.toBeChecked();
    expect(checkbox2).not.toBeChecked();
    expect(CheckBoxListState).toEqual([]);

  });

  it("Should display the default label 'CheckBoxList' when no label prop is provided", () => {
    const data = [{ label: 'label1', value: 'value1' }];

    render(<CheckBoxList data={data} onChange={onChange} />);
    const label = screen.getByText('CheckBoxList');

    expect(label).not.toBeNull();
  });

  it('Should throw an error when data prop is not provided', () => {
    try {
      render(<CheckBoxList data={undefined as unknown as []} onChange={onChange} />);
    } catch (error: any) {
      expect(error.message).toBe("Cannot read properties of undefined (reading 'map')");
    }
  });
});
