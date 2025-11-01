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
    const user = userEvent.setup();
    render(
      <TooltipWrapper content='Tooltip content'>
        <button>Test Button</button>
      </TooltipWrapper>,
    );

    const button = screen.getByTestId('default-tooltip-trigger');
    await user.hover(button);

    await waitFor(
      () => {
        const tooltipContent = screen.getByTestId('default-tooltip-content');
        expect(tooltipContent).toBeInTheDocument();
        expect(tooltipContent).toHaveTextContent('Tooltip content');
      },
      { timeout: 2000 },
    );
  });

  it('hides tooltip when mouse leaves', async () => {
    const user = userEvent.setup();
    render(
      <TooltipWrapper content='Tooltip content'>
        <button>Test Button</button>
      </TooltipWrapper>,
    );

    const trigger = screen.getByTestId('default-tooltip-trigger');
    await user.hover(trigger);

    await waitFor(
      () => {
        const tooltipContent = screen.getByTestId('default-tooltip-content');
        expect(tooltipContent).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    await user.unhover(trigger);

    await waitFor(
      () => {
        const tooltipContent = screen.queryByTestId('default-tooltip-content');
        expect(tooltipContent).not.toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });
});
