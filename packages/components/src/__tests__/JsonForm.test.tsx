import React from 'react';
import { fireEvent, render, screen, act } from '@testing-library/react';
import fetchMock from 'jest-fetch-mock';
import { JsonForms } from '@jsonforms/react';

import { schema, initialData, uiSchema } from './mocks/JsonForm.mock';
import { JsonForm } from '../components/JsonForm/JsonForm';

// Enable fetch mocks
fetchMock.enableMocks();

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

  it('should fetch and render schema from url', async () => {
    const schemaUrl = 'https://jsonforms.io/schema.json';
    // Mock the fetch response
    fetchMock.mockResponseOnce(JSON.stringify(schema));

    // Wrap the rendering inside act(...)
    await act(async () => {
      render(
        <JsonForm
          schema={{ url: schemaUrl }}
          data={initialData}
          onChange={onChangeJsonSchemaForm}
          className='json-form'
        />,
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(schemaUrl);

    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).toHaveValue(initialData.name);

    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).toBeChecked();
  });

  it('should fetch and render schema with data from url', async () => {
    const schemaUrl = 'https://jsonforms.io/schema.json';
    fetchMock.mockResponseOnce(JSON.stringify(initialData));

    await act(async () => {
      render(
        <JsonForm schema={schema} data={{ url: schemaUrl }} onChange={onChangeJsonSchemaForm} className='json-form' />,
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(schemaUrl);

    const getStringField = screen.getByLabelText('Name');
    expect(getStringField).toHaveValue(initialData.name);
    expect(getStringField).toHaveValue('James A. Fernandes');

    const getBooleanField = screen.getByLabelText('Vegetarian');
    expect(getBooleanField).toBeChecked();
  });

  it('should show error message when fetch schema failed', async () => {
    const schemaUrl = 'https://jsonforms.io/schema.json';
    fetchMock.mockReject(new Error('Failed to fetch schema'));

    await act(async () => {
      render(<JsonForm schema={{ url: schemaUrl }} onChange={onChangeJsonSchemaForm} className='json-form' />);
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(schemaUrl);

    const errorElement = screen.getByText('Error setup schema');
    expect(errorElement).toBeInTheDocument();
  });

  it('should show error message when fetch data failed', async () => {
    const dataUrl = 'https://jsonforms.io/data.json';
    fetchMock.mockReject(new Error('Failed to fetch data'));

    await act(async () => {
      render(
        <JsonForm schema={schema} data={{ url: dataUrl }} onChange={onChangeJsonSchemaForm} className='json-form' />,
      );
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(dataUrl);

    const errorElement = screen.getByText('Error setup data');
    expect(errorElement).toBeInTheDocument();
  });
});
