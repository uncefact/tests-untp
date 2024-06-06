import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import { CustomDialog } from '../components/CustomDialog';

describe('CustomDialog Component', () => {
  it('should renders with title, content, and buttons', () => {
    // Mocking the onClose function
    const onCloseMock = jest.fn();

    // Render the CustomDialog component with mock props
    render(
      <CustomDialog
        open={true}
        onClose={onCloseMock}
        title='Test Title'
        content='Test Content'
        buttons={<button>Custom Button</button>}
      />,
    );

    // Expecting the text 'Test Title' to be present in the rendered component
    expect(screen.getByText('Test Title')).not.toBeNull();
    // Expecting the text 'Test Content' to be present in the rendered component
    expect(screen.getByText('Test Content')).not.toBeNull();
    // Expecting the text 'Custom Button' to be present in the rendered component
    expect(screen.getByText('Custom Button')).not.toBeNull();
  });

  it('calls onClose function when close button is clicked', () => {
    // Mocking the onClose function
    const onCloseMock = jest.fn();

    // Render the CustomDialog component with mock props
    render(<CustomDialog open={true} onClose={onCloseMock} title='Test Title' content='Test Content' />);
    // Simulate a click event on the 'Close' button
    fireEvent.click(screen.getByText('Close'));

    // Expecting the onClose function to have been called
    expect(onCloseMock).toHaveBeenCalled();
  });

});
