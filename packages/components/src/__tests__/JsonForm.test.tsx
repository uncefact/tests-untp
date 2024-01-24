import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { JsonForm } from '../components/json-form';
import { schema, initialData, uischema } from './mocks/json-form.mock';

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

  it('should render component with schema props', async () => {
    const jsonData = {
      schema,
      onChangeJsonSchemaForm: ({ errors, data }: { errors: any[]; data: any }) => {
        console.log('onChangeJsonSchemaForm', errors, data);
      },
    };
    render(<JsonForm jsonData={jsonData} className='json-form' />);
    const getStringField = screen.getByLabelText('String');
    expect(getStringField).not.toBeNull();
    const getBooleanField = screen.getByLabelText('Boolean');
    expect(getBooleanField).not.toBeNull();
  });

  it('should render component with schema and ui schema props', async () => {
    const jsonData = {
      schema,
      uischema,
      onChangeJsonSchemaForm: ({ errors, data }: { errors: any[]; data: any }) => {
        console.log('onChangeJsonSchemaForm', errors, data);
      },
    };
    render(<JsonForm jsonData={jsonData} className='json-form' />);
    const getStringField = screen.getByLabelText('String');
    expect(getStringField).not.toBeNull();
    const getBooleanField = screen.getByLabelText('Boolean');
    expect(getBooleanField).not.toBeNull();
  });

  it('should render component with schema, ui schema and initial data props', async () => {
    const jsonData = {
      schema,
      uischema,
      initialData,
      onChangeJsonSchemaForm: ({ errors, data }: { errors: any[]; data: any }) => {
        console.log('onChangeJsonSchemaForm', errors, data);
      },
    };
    render(<JsonForm jsonData={jsonData} className='json-form' />);

    const getStringField = screen.getByLabelText('String');
    expect(getStringField).toHaveValue('This is a string');

    const getBooleanField = screen.getByLabelText('Boolean');
    expect(getBooleanField).toBeChecked();
  });

  it('should display value when input on label', async () => {
    const jsonData = {
      schema,
      onChangeJsonSchemaForm: ({ errors, data }: { errors: any[]; data: any }) => {
        console.log('onChangeJsonSchemaForm', errors, data);
      },
    };
    render(<JsonForm jsonData={jsonData} className='json-form' />);
    const getStringField = screen.getByLabelText('String');
    expect(getStringField).not.toBeNull();

    await fireEvent.change(getStringField, { target: { value: 'This is a string' } });

    // act(() => {
    //   fireEvent.change(getStringField, { target: { value: 'This is a string' } });
    // });
    expect(getStringField).toHaveValue('This is a string');

    await fireEvent.change(getStringField, { target: { value: '' } });

    // act(() => {
    //   fireEvent.change(getStringField, { target: { value: '' } });
    // });
    expect(getStringField).toHaveValue('');

    const getBooleanField = screen.getByLabelText('Boolean');
    expect(getBooleanField).not.toBeNull();

    await fireEvent.click(getBooleanField);

    // act(() => {
    //   fireEvent.click(getBooleanField);
    // });
    expect(getBooleanField).toBeChecked();

    await fireEvent.click(getBooleanField);
    // act(() => {
    //   fireEvent.click(getBooleanField);
    // });
    expect(getBooleanField).not.toBeChecked();
  });
});
