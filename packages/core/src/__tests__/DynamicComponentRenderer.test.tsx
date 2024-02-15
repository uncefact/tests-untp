import React from 'react';
import { render, screen } from '@testing-library/react';
import { JsonForm } from '@mock-app/components';
import { DynamicComponentRenderer, ComponentType } from '../components/GenericFeature/DynamicComponentRenderer';

jest.mock('@mock-app/components', () => ({
  JsonForm: jest.fn(),
}));

describe('DynamicComponentRenderer', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('should render component with valid props name', () => {
    (JsonForm as any).mockImplementation(() => <>jsonform</>);
    render(
      <DynamicComponentRenderer name='JsonForm' type={ComponentType.EntryData} props={{ name: 'test', label: 'test' }} />,
    );
    expect(screen.getByText('jsonform')).not.toBeNull();
  });

  test('should render null with invalid props name', () => {
    render(
      <DynamicComponentRenderer name='Footer' type={ComponentType.Void} props={{ name: 'test', label: 'test' }} />,
    );
    expect(screen.queryByText('jsonform')).toBeNull();
  });
});
