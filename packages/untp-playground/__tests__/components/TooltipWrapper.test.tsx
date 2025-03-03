import { TooltipWrapper } from '@/components/TooltipWrapper';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

describe('TooltipWrapper', () => {
  it('renders children without tooltip when disabled', () => {
    render(
      <TooltipWrapper content='Tooltip content' disabled>
        <button>Test Button</button>
      </TooltipWrapper>,
    );

    expect(screen.getByText('Test Button')).toBeInTheDocument();
  });

  it('renders tooltip with content when hovering', async () => {
    render(
      <TooltipWrapper content='Tooltip content'>
        <button>Test Button</button>
      </TooltipWrapper>,
    );

    const button = screen.getByTestId('default-tooltip-trigger');
    userEvent.hover(button);

    await waitFor(() => {
      const tooltipContent = screen.getByTestId('default-tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
      expect(tooltipContent).toHaveTextContent('Tooltip content');
    });
  });

  it('hides tooltip when mouse leaves', async () => {
    render(
      <TooltipWrapper content='Tooltip content'>
        <button>Test Button</button>
      </TooltipWrapper>,
    );

    const trigger = screen.getByTestId('default-tooltip-trigger');
    userEvent.hover(trigger);

    await waitFor(() => {
      const tooltipContent = screen.getByTestId('default-tooltip-content');
      expect(tooltipContent).toBeInTheDocument();
    });

    userEvent.unhover(trigger);

    await waitFor(() => {
      const tooltipContent = screen.queryByTestId('default-tooltip-content');
      expect(tooltipContent).not.toBeInTheDocument();
    });
  });
});
