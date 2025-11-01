import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConformityCredentialCheckbox } from '../components/ConformityCredentialCheckBox';
import { getCaseInsensitive } from '../components/ConformityCredentialCheckBox/utils';

jest.mock('../components/ConformityCredentialCheckBox/utils', () => ({
  getCaseInsensitive: jest.fn(),
}));

describe('ConformityCredentialCheckbox', () => {
  const onChange = jest.fn();

  it('should render ConformityCredentialCheckbox with text', () => {
    render(<ConformityCredentialCheckbox onChange={onChange} />);
    const renderedButton = screen.getByText('Conformity Credential');
    expect(renderedButton).not.toBeNull();
  });

  it('should trigger onChange event with single checkbox', () => {
    (getCaseInsensitive as jest.Mock).mockReturnValue([{ name: 'testCheckbox', url: 'https://example.com' }]);
    const onChangeUpdate = jest.fn();

    render(<ConformityCredentialCheckbox onChange={onChangeUpdate} />);
    const checkbox = screen.getByText('testCheckbox');

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeNull();
    expect(getCaseInsensitive).toHaveBeenCalled();
    expect(onChangeUpdate).toHaveBeenCalledWith({
      data: { conformityCredential: [{ name: 'testCheckbox', url: 'https://example.com' }] },
    });
  });

  it('should trigger onChange event with multiple checkboxes', () => {
    (getCaseInsensitive as jest.Mock).mockReturnValue([
      { name: 'testCheckbox', url: 'https://example.com' },
      { name: 'testCheckbox2', url: 'https://example2.com' },
    ]);
    const onChangeUpdate = jest.fn();

    render(<ConformityCredentialCheckbox onChange={onChangeUpdate} />);
    const checkbox = screen.getByText('testCheckbox');
    const checkbox2 = screen.getByText('testCheckbox2');

    fireEvent.click(checkbox);
    fireEvent.click(checkbox2);
    expect(checkbox).not.toBeNull();
    expect(checkbox2).not.toBeNull();
    expect(getCaseInsensitive).toHaveBeenCalled();
    expect(onChangeUpdate).toHaveBeenCalledWith({
      data: {
        conformityCredential: [
          { name: 'testCheckbox', url: 'https://example.com' },
          { name: 'testCheckbox2', url: 'https://example2.com' },
        ],
      },
    });
  });

  it('should not trigger onChange event with no checkboxes', () => {
    (getCaseInsensitive as jest.Mock).mockReturnValue([]);
    const onChangeUpdate = jest.fn();

    render(<ConformityCredentialCheckbox onChange={onChangeUpdate} />);
    expect(getCaseInsensitive).toHaveBeenCalled();
    expect(onChangeUpdate).not.toHaveBeenCalled();
  });

  it('should not trigger onChange event with no data', () => {
    (getCaseInsensitive as jest.Mock).mockReturnValue(undefined);
    const onChangeUpdate = jest.fn();

    render(<ConformityCredentialCheckbox onChange={onChangeUpdate} />);
    expect(getCaseInsensitive).toHaveBeenCalled();
    expect(onChangeUpdate).not.toHaveBeenCalled();
  });

  it('should uncheck when click on double', () => {
    (getCaseInsensitive as jest.Mock).mockReturnValue([{ name: 'testCheckbox', url: 'https://example.com' }]);
    const onChangeUpdate = jest.fn();

    render(<ConformityCredentialCheckbox onChange={onChangeUpdate} />);
    const checkbox = screen.getByRole('checkbox', { name: 'testCheckbox' });

    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();
    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();
  });
});
