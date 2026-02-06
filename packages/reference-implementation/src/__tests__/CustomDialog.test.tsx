import { render, fireEvent, screen } from '@testing-library/react';
import { CustomDialog } from '../components/CustomDialog';

// Mocking MUI components
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({
    children,
    open,
    onClose,
    ...props
  }: {
    children?: React.ReactNode;
    open?: boolean;
    onClose?: () => void;
    [key: string]: unknown;
  }) =>
    open ? (
      <div data-testid='dialog' onClick={onClose} {...props}>
        {children}
      </div>
    ) : null,
}));

jest.mock('@mui/material/DialogTitle', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid='dialog-title' {...props}>
      {children}
    </div>
  ),
}));

jest.mock('@mui/material/DialogContent', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid='dialog-content' {...props}>
      {children}
    </div>
  ),
}));

jest.mock('@mui/material/DialogActions', () => ({
  __esModule: true,
  default: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div data-testid='dialog-actions' {...props}>
      {children}
    </div>
  ),
}));

jest.mock('@mui/material', () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

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
    expect(screen.getByText('Test Title')).toBeInTheDocument();
    // Expecting the text 'Test Content' to be present in the rendered component
    expect(screen.getByText('Test Content')).toBeInTheDocument();
    // Expecting the text 'Custom Button' to be present in the rendered component
    expect(screen.getByText('Custom Button')).toBeInTheDocument();
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
