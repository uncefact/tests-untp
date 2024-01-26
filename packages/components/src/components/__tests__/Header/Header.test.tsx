import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { Header } from '../../../';

describe('Header', () => {
  // Define an array of router links for testing
  const routerLinks = [
    { title: 'Menu 1', path: '/menu-1' },
    { title: 'Menu 2', path: '/menu-2' },
    { title: 'Menu 3', path: '/menu-3' },
  ];
  // Define a constant for the logo title
  const logoTitle = 'Logo';

  test('Render header when the screen is large', () => {
    // Set the screen width to 1024 pixels
    global.innerWidth = 1024;

    // Render the Header component with specified props
    render(<Header logoTitle={logoTitle} routerLinks={routerLinks} />);

    // Expect the menu for large screens to be visible
    expect(screen.getByTestId('menu-desktop')).toBeVisible();

    // Expect at least one element with the text 'Logo' to be present
    expect(screen.getAllByText(/Logo/i)[0]).not.toBeNull();
  });

  test('Render menu when the button is clicked on a small screen', () => {
    // Set the screen width to 600 pixels
    global.innerWidth = 600;

    // Render the Header component with specified props
    render(<Header logoTitle={logoTitle} routerLinks={routerLinks} />);

    // Find and expect the mobile menu button to be visible
    const iconButton = screen.getByTestId('icon-button');
    expect(iconButton).toBeVisible();

    // Simulate a click on the mobile menu button
    fireEvent.click(iconButton);

    // Expect the mobile menu to have the style 'display: block'
    expect(screen.getByTestId('menu-appbar')).toHaveStyle('display: block');

    // Expect at least one element with the text 'Logo' to be present
    expect(screen.getAllByText(/Logo/i)[0]).not.toBeNull();
  });

  test('Close mobile menu when a menu item is clicked', async () => {
    global.innerWidth = 600;

    // Render the Header component with specified props
    render(<Header logoTitle={logoTitle} routerLinks={routerLinks} />);

    // Simulate clicking the mobile menu icon to open the menu
    const iconButton = screen.getByTestId('icon-button');
    fireEvent.click(iconButton);

    // Expect the mobile menu to be visible
    const mobileMenu = screen.getByTestId('menu-appbar');
    expect(mobileMenu).toHaveStyle('display: block');

    // Simulate clicking a menu item to close the menu
    const menuItem = screen.getByRole('link', {
      name: 'Menu 1',
    });
    fireEvent.click(menuItem);

    // Wait for the menu animation to complete and expect the menu to be hidden
    await waitFor(() => {
      expect(screen.getByTestId('menu-appbar')).toHaveClass('MuiModal-hidden ');
    });
  });

  test('Render header with customized colors', () => {
    // Set the screen width to 600 pixels
    global.innerWidth = 600;

    // Define colors for the logo and background
    const logoTitleColor = '#fff';
    const backgroundColor = '#000';

    // Render the Header component with specified color props
    render(<Header logoTitleColor={logoTitleColor} backgroundColor={backgroundColor} routerLinks={routerLinks} />);

    // Expect the header background color to match the specified background color
    const header = screen.getByTestId('header');
    expect(header).toHaveStyle(`background-color: ${backgroundColor}`);

    // Expect the logo text color to match the specified logo color
    const logo = screen.getByTestId('logo');
    expect(logo).toHaveStyle(`color: ${logoTitleColor}`);
  });
});
