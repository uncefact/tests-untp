import React from 'react';
import { screen, render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Router } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { BackButton } from '../components/BackButton';

describe('BackButton', () => {
  it('should renders the button with default variant', () => {
    // Render the BackButton component within a MemoryRouter
    render(
      <MemoryRouter>
        <BackButton />
      </MemoryRouter>,
    );

    // Assert that the button with text "Go back" is rendered
    const button = screen.getByText(/Go back/i);
    expect(button).toBeInTheDocument();
    // Assert that the button has the default MuiButton-contained class
    expect(button).toHaveClass('MuiButton-contained');
  });

  it('should renders the button with provided variant', () => {
    // Render the BackButton component with variant='outlined' within a MemoryRouter
    render(
      <MemoryRouter>
        <BackButton variant='outlined' />
      </MemoryRouter>,
    );

    // Assert that the button with text "Go back" is rendered
    const button = screen.getByText(/Go back/i);
    expect(button).toBeInTheDocument();
    // Assert that the button has the MuiButton-outlined class
    expect(button).toHaveClass('MuiButton-outlined');
  });

  it('should calls onNavigate callback and navigates when clicked', () => {
    // Create a mock function for the onNavigate callback
    const onNavigateMock = jest.fn();
    // Create a memory history with an initial entry '/farm'
    const history = createMemoryHistory({ initialEntries: ['/farm'] });

    // Render the BackButton component within a Router component with the created history
    render(
      <Router location={history.location} navigator={history}>
        <BackButton onNavigate={onNavigateMock} />
      </Router>,
    );
    // Find the button with text "Go back" and simulate a click event
    const button = screen.getByText(/Go back/i);
    fireEvent.click(button);

    // Expect the Router to navigate to the '/' route
    expect(history.location.pathname).toBe('/');
  });
});
