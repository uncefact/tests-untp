import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { JsonForms } from '@jsonforms/react';

import { schema, initialData, uiSchema } from './mocks/JsonForm.mock';
import { JsonForm } from '../components/JsonForm/JsonForm';

describe('render json schema component', () => {
  beforeEach(() => {
    /*
     * JSONForms package uses `Hidden of Material UI` which does not output anything depending on the queries/environment
     * In our tests, we need to mock the `matchMedia` to render the UI of JSONForms
     * Ref: https://jsonforms.discourse.group/t/jsonforms-unit-test-renders-empty-div/1436
     */
    window.matchMedia = jest.fn().mockImplementation((query) => {
      return {
        matches: true,
        media: query,
        onchange: null,
        addListener: jest.fn(),
        removeListener: jest.fn(),
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
        dispatchEvent: jest.fn(),
      };
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  const onChangeJsonSchemaForm = ({ data, errors }: { data: any; errors?: any[] }) => {
    console.log('onChangeJsonSchemaForm', errors, data);
  };

  it('should render component with schema props', async () => {
    render(<JsonForm schema={schema} onChange={onChangeJsonSchemaForm} className='json-form' />);
    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).not.toBeNull();
    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).not.toBeNull();
  });

  it('should render component with schema and ui schema props', async () => {
    render(<JsonForm schema={schema} uiSchema={uiSchema} onChange={onChangeJsonSchemaForm} className='json-form' />);
    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).not.toBeNull();
    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).not.toBeNull();
  });

  it('should render component with schema, ui schema and initial data props', async () => {
    render(
      <JsonForm
        schema={schema}
        uiSchema={uiSchema}
        data={initialData}
        onChange={onChangeJsonSchemaForm}
        className='json-form'
      />,
    );

    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).toHaveValue(initialData.name);

    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).toBeChecked();
  });

  it('should display value when input on label', async () => {
    render(<JsonForm schema={schema} onChange={onChangeJsonSchemaForm} className='json-form' />);
    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).not.toBeNull();

    await fireEvent.change(getStringField, { target: { value: 'Dwight D. Terry' } });
    expect(getStringField).toHaveValue('Dwight D. Terry');

    await fireEvent.change(getStringField, { target: { value: '' } });
    expect(getStringField).toHaveValue('');

    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).not.toBeNull();

    await fireEvent.click(getBooleanField);
    expect(getBooleanField).toBeChecked();

    await fireEvent.click(getBooleanField);
    expect(getBooleanField).not.toBeChecked();
  });

  // Currently, this test is not working. It is not calling the onChange function because the test can not mock JsonForm library to trigger the onChange function.
  // TODO: Find the way to trigger the onChange function
  it.skip('should return value on props function when input on change', () => {
    (JsonForms as jest.Mock).mockImplementationOnce(({ onChange, renderers, cells }) => {});

    const onChange = jest.fn();
    render(<JsonForm schema={schema} onChange={onChange} className='json-form' />);
    const button = screen.getByText('Click me');
    fireEvent.click(button);
    expect(onChange).toHaveBeenCalledWith({ data: { name: 'Dwight D. Terry' }, errors: [] });
  });
});
