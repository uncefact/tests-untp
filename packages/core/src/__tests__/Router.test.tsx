import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Router } from '../components/Router';
import '@testing-library/jest-dom';

// Mock the appConfig to provide test data
// jest.mock('../../constants/app-config.json', () => ({
//   apps: [
//     // Mock your app data here
//   ],
// }));

// Write the test suite
describe('Router Component', () => {
  it('renders without crashing', () => {
    render(
      <MemoryRouter>
        <Router />
      </MemoryRouter>
    );
  });

  it('renders home route correctly', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Router />
      </MemoryRouter>
    );

    expect(screen.getByText('Features')).toBeInTheDocument();
  });

  it('renders app route and features correctly', () => {
    render(
      <MemoryRouter initialEntries={['/farm']}>
        <Router />
      </MemoryRouter>
    );

    // Expect app-specific elements to be present on the page
    expect(screen.getByText('Wagu Wonder')).toBeInTheDocument();
    expect(screen.getByText('Issue DLP')).toBeInTheDocument();
  });

  it('navigates to a specific feature route correctly', () => {
    render(
      <MemoryRouter initialEntries={['/farm/issue-dlp']}>
        <Router />
      </MemoryRouter>
    );

    // Expect the specific feature component to be rendered
    expect(screen.getByText('NLISID')).toBeInTheDocument();
  });

  it('navigates between routes correctly', () => {
    const { history } = render(
      <MemoryRouter initialEntries={['/']}>
        <Router />
      </MemoryRouter>
    );

    // Navigate to the 'Farm' app
    fireEvent.click(screen.getByText('Farm'));
    expect(history.location.pathname).toBe('/farm');

    // Navigate back to the home route
    fireEvent.click(screen.getByText('Features'));
    expect(history.location.pathname).toBe('/');
  });

});
