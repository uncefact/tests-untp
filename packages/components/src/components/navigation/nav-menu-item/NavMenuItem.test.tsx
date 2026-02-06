import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NavMenuItem } from './NavMenuItem';

const TestIcon = () => <svg data-testid='test-icon'>Icon</svg>;

describe('NavMenuItem', () => {
  it('renders the component', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' />);

    expect(screen.getByTestId('nav-menu-item-configuration')).toBeInTheDocument();
  });

  it('renders label text', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' />);

    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('renders with URL icon', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' />);

    const icon = screen.getByTestId('nav-menu-item-configuration-icon');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('src', '/icons/settings.svg');
  });

  it('renders with React component icon', () => {
    render(<NavMenuItem label='Configuration' icon={<TestIcon />} />);

    const iconWrapper = screen.getByTestId('nav-menu-item-configuration-icon');
    expect(within(iconWrapper).getByTestId('test-icon')).toBeInTheDocument();
  });

  it('renders without icon', () => {
    render(<NavMenuItem label='Configuration' />);

    expect(screen.queryByTestId('nav-menu-item-configuration-icon')).not.toBeInTheDocument();
    expect(screen.getByText('Configuration')).toBeInTheDocument();
  });

  it('calls onClick when label is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();

    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' onClick={handleClick} />);

    // Click on the label text
    const label = screen.getByText('Configuration');
    await user.click(label);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('calls onChevronClick when chevron is clicked', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();
    const handleChevronClick = jest.fn();

    render(
      <NavMenuItem
        label='Resources'
        icon='/icons/settings.svg'
        isExpandable
        onClick={handleClick}
        onChevronClick={handleChevronClick}
      />,
    );

    const chevron = screen.getByTestId('nav-menu-item-resources-chevron');
    await user.click(chevron);

    expect(handleChevronClick).toHaveBeenCalledTimes(1);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('applies active styles', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' isActive />);

    const navItem = screen.getByTestId('nav-menu-item-configuration');
    expect(navItem).toHaveClass('bg-nav-item-active');
  });

  it('applies hover styles when not active', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' />);

    const navItem = screen.getByTestId('nav-menu-item-configuration');
    expect(navItem).toHaveClass('hover:bg-nav-item-hover');
  });

  it('renders with custom className', () => {
    render(<NavMenuItem label='Configuration' icon='/icons/settings.svg' className='custom-class' />);

    const navItem = screen.getByTestId('nav-menu-item-configuration');
    expect(navItem).toHaveClass('custom-class');
  });

  it('renders as expandable with chevron', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExpandable />);

    const chevron = screen.getByTestId('nav-menu-item-resources-chevron');
    expect(chevron).toBeInTheDocument();
  });

  it('rotates chevron when expanded', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExpandable isExpanded />);

    const chevron = screen.getByTestId('nav-menu-item-resources-chevron');
    expect(chevron).toHaveClass('rotate-180');
  });

  it('applies sub-item padding', () => {
    render(<NavMenuItem label='Sub Item' icon='/icons/settings.svg' isSubItem />);

    const navItem = screen.getByTestId('nav-menu-item-sub-item');
    expect(navItem).toHaveClass('pl-10');
  });

  it('generates correct test id from label with spaces', () => {
    render(<NavMenuItem label='My Settings' icon='/icons/settings.svg' />);

    expect(screen.getByTestId('nav-menu-item-my-settings')).toBeInTheDocument();
  });

  it('renders external link indicator when isExternal is true', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExternal />);

    const externalIcon = screen.getByTestId('nav-menu-item-resources-external');
    expect(externalIcon).toBeInTheDocument();
  });

  it('does not render external link indicator when isExternal is false', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' />);

    expect(screen.queryByTestId('nav-menu-item-resources-external')).not.toBeInTheDocument();
  });

  it('applies correct styles to external link indicator when active', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExternal isActive />);

    const externalIcon = screen.getByTestId('nav-menu-item-resources-external');
    expect(externalIcon).toHaveClass('!text-nav-item-foreground-active');
  });

  it('applies correct styles to external link indicator when inactive', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExternal />);

    const externalIcon = screen.getByTestId('nav-menu-item-resources-external');
    expect(externalIcon).toHaveClass('text-nav-item-foreground-inactive');
  });

  it('does not render external link indicator when item is expandable', () => {
    render(<NavMenuItem label='Resources' icon='/icons/settings.svg' isExternal isExpandable />);

    // Should show chevron but not external icon
    expect(screen.getByTestId('nav-menu-item-resources-chevron')).toBeInTheDocument();
    expect(screen.queryByTestId('nav-menu-item-resources-external')).not.toBeInTheDocument();
  });
});
