/**
 * @jest-environment jsdom
 */

import { ErrorDialog } from '@/components/ErrorDialog';
import { fireEvent, render, screen } from '@testing-library/react';

// Mock clipboard API
Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn(),
  },
});

describe('ErrorDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null when no errors are provided', () => {
    const { container } = render(<ErrorDialog errors={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when errors is not an array', () => {
    // @ts-ignore - Testing invalid input
    const { container } = render(<ErrorDialog errors={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('displays validation errors correctly', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
      {
        keyword: 'required',
        instancePath: '/data',
        params: { missingProperty: 'requiredField' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Check if error count is displayed
    expect(screen.getByText(/we found 2 issues/i)).toBeInTheDocument();

    // Check if error locations are displayed
    expect(screen.getByText(/data → field1/i)).toBeInTheDocument();
    expect(screen.getByText(/wrong type/i)).toBeInTheDocument();
    expect(screen.getByText(/missing field/i)).toBeInTheDocument();
  });

  it('displays warnings for additional properties', () => {
    const errors = [
      {
        keyword: 'additionalProperties',
        instancePath: '',
        params: { additionalProperty: 'extraField' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText(/1 warning/i)).toBeInTheDocument();
    expect(screen.getByText(/additional property: "extraField"/i)).toBeInTheDocument();
  });

  it('handles expandable error details', async () => {
    const errors = [
      {
        keyword: 'enum',
        instancePath: '/data/status',
        params: { allowedValues: ['active', 'inactive'] },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Click to expand error details
    const button = screen.getByRole('button', { name: /choose from allowed values/i });
    fireEvent.click(button);

    // Check if expanded content is visible
    expect(screen.getByText(/must be one of:/i)).toBeInTheDocument();
    expect(screen.getByText(/active, inactive/i)).toBeInTheDocument();
  });

  it('handles copy functionality', async () => {
    const errors = [
      {
        keyword: 'const',
        instancePath: '/data/type',
        params: { allowedValue: 'user' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Expand the error details
    const expandButton = screen.getByRole('button', { name: /use the correct value/i });
    fireEvent.click(expandButton);

    // Click copy button
    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    // Verify clipboard API was called
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('"user"');

    // Verify "Copied!" text appears
    expect(screen.getByText(/copied!/i)).toBeInTheDocument();
  });

  it('displays correct tips based on error type', () => {
    const errors = [
      {
        keyword: 'const',
        instancePath: '/data/type',
        params: { allowedValue: 'user' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Expand the error details
    const expandButton = screen.getByRole('button', { name: /use the correct value/i });
    fireEvent.click(expandButton);

    // Verify tip content
    expect(screen.getByText(/this value must match exactly as shown above/i)).toBeInTheDocument();
  });

  it('groups multiple errors for the same path', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
      {
        keyword: 'minLength',
        instancePath: '/data/field1',
        params: { limit: 3 },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Should show only one group for '/data/field1'
    expect(screen.getByText(/we found 1 issue/i)).toBeInTheDocument();
    expect(screen.getByText(/data → field1/i)).toBeInTheDocument();
  });

  it('applies custom className when provided', () => {
    const errors = [
      {
        keyword: 'type',
        instancePath: '/data/field1',
        params: { type: 'string' },
      },
    ] as any;

    const { container } = render(<ErrorDialog errors={errors} className='custom-class' />);
    expect(container.firstChild).toHaveClass('custom-class');
  });

  it('displays missingValue error details correctly', () => {
    const errors = [
      {
        keyword: 'missingValue',
        instancePath: '@context[0]',
        message: 'The first element of "@context" must be one of the following:',
        params: { allowedValues: ['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/ns/credentials/v2'] },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText(/we found 1 issue/i)).toBeInTheDocument();

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText(/the first element of "@context" must be one of the following:/i)).toBeInTheDocument();

    expect(
      screen.getByText((content, element) => {
        return (
          content.includes('https://www.w3.org/2018/credentials/v1') &&
          content.includes('https://www.w3.org/ns/credentials/v2')
        );
      }),
    ).toBeInTheDocument();

    const copyButton = screen.getByRole('button', { name: /copy/i });
    fireEvent.click(copyButton);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      JSON.stringify(['https://www.w3.org/2018/credentials/v1', 'https://www.w3.org/ns/credentials/v2'], null, 2),
    );

    expect(screen.getByText(/missing value/i)).toBeInTheDocument();
  });

  it('displays minItems error details correctly', () => {
    const errors = [
      {
        keyword: 'minItems',
        instancePath: '@context',
        message: 'The "@context" array must contain at least one item.',
        params: { minItems: 1 },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    expect(screen.getByText(/we found 1 issue/i)).toBeInTheDocument();

    const button = screen.getByRole('button');
    fireEvent.click(button);

    expect(screen.getByText(/expected minimum number of items:/i)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();

    expect(screen.getByText(/to few items/i)).toBeInTheDocument();
  });
});
