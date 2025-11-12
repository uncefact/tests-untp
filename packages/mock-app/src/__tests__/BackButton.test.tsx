import { screen, render, fireEvent } from '@testing-library/react';
import { BackButton } from '../components/BackButton';

const mockReplace = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: mockReplace,
  }),
}));

// Mocking MUI components
jest.mock('@mui/material', () => ({
  Box: ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  Button: ({
    children,
    onClick,
    variant,
    ...props
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    variant?: string;
    [key: string]: unknown;
  }) => (
    <button onClick={onClick} className={`MuiButton-${variant || 'contained'}`} {...props}>
      {children}
    </button>
  ),
}));

describe('BackButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should renders the button with default variant', () => {
    // Render the BackButton component
    render(<BackButton />);

    // Assert that the button with text "Go back" is rendered
    const button = screen.getByText(/Go back/i);
    expect(button).toBeInTheDocument();
    // Assert that the button has the default MuiButton-contained class
    expect(button).toHaveClass('MuiButton-contained');
  });

  it('should renders the button with provided variant', () => {
    // Render the BackButton component with variant='outlined'
    render(<BackButton variant='outlined' />);

    // Assert that the button with text "Go back" is rendered
    const button = screen.getByText(/Go back/i);
    expect(button).toBeInTheDocument();
    // Assert that the button has the MuiButton-outlined class
    expect(button).toHaveClass('MuiButton-outlined');
  });

  it('should calls onNavigate callback and navigates when clicked', () => {
    // Create a mock function for the onNavigate callback
    const onNavigateMock = jest.fn();

    // Render the BackButton component with onNavigate callback
    render(<BackButton onNavigate={onNavigateMock} />);

    // Find the button with text "Go back" and simulate a click event
    const button = screen.getByText(/Go back/i);
    fireEvent.click(button);

    // Expect the onNavigate callback to be called
    expect(onNavigateMock).toHaveBeenCalledTimes(1);
    // Expect the Next.js router.replace to be called with '/'
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});
