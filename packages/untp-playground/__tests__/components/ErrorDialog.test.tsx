/**
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorDialog } from '@/components/ErrorDialog';

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

  it('displays correct tips based on error type "const"', () => {
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
    expect(screen.getByText(/Update the value\(s\) to the correct one\(s\) or remove the field\(s\)/i)).toBeInTheDocument();
  });

  it('displays correct tips based on error type "conflictingProperties"', () => {
    const errors = [
      {
        keyword: 'conflictingProperties',
        instancePath: '@context',
        params: { conflictingProperty: 'name' },
      },
    ] as any;

    render(<ErrorDialog errors={errors} />);

    // Expand the error details
    const expandButton = screen.getByRole('button', { name: /Fix validation error/i });
    fireEvent.click(expandButton);

    // Verify tip content
    expect(screen.getByText(/Resolve the conflict by removing the conflicting field or updating it to a unique one/i)).toBeInTheDocument();
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
});
