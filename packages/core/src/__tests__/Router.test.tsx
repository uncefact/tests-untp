import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Router as RouterDom } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import { Header } from '../components/Header';
import { Router } from '../components/Router';

// Mock the appConfig to provide test data
jest.mock(
  '../../src/constants/app-config.json',
  () => ({
    apps: [
      {
        name: 'Farm',
        features: [{ name: 'Issue DLP' }],
      },
      {
        name: 'Feedlot',
        features: [{ name: 'Import DLP' }, { name: 'Feed Cattle' }, { name: 'Sell Cattle' }],
      },
      {
        name: 'Processor',
        features: [{ name: 'Import DLP' }, { name: 'Process Cattle' }],
      },
    ],
  }),
  { virtual: true },
);

describe('Router Component', () => {
  // Test case to check if the Router redirects to the 404 page for an invalid route
  it('renders route incorrectly', () => {
    // Create a memory history object with an initial entry of an invalid route
    const history = createMemoryHistory({ initialEntries: ['/invalid-route'] });
    // Render the Router component with the provided history
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    // Expect the Router to navigate to the '/404' route
    expect(history.location.pathname).toBe('/404');
  });

  // Test case to check if clicking on a link in the Header navigates to the correct route
  it('renders route correctly', () => {
    // Create a memory history object with an initial entry of the home route ('/')
    const history = createMemoryHistory({ initialEntries: ['/'] });
    // Render the Header component with the provided history
    render(
      <RouterDom location={history.location} navigator={history}>
        <Header />
      </RouterDom>,
    );
    
    // Simulate a click on a link in the Header (Farm)
    fireEvent.click(screen.getByRole('link', { name: /Farm/i }));
    // Expect the Router to navigate to the '/farm' route
    expect(history.location.pathname).toBe('/farm');
  });

  // Test case to check if clicking on a feature in the Router navigates to the correct subpath
  it('renders route subpath correctly', () => {
    // Create a memory history object with an initial entry of the '/farm' route
    const history = createMemoryHistory({ initialEntries: ['/farm'] });
    // Render the Router component with the provided history
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    // Simulate a click on a feature in the Router (Issue DLP)
    fireEvent.click(screen.getByText('Issue DLP'));
    // Expect the Router to navigate to the '/farm/issue-dlp' subpath
    expect(history.location.pathname).toBe('/farm/issue-dlp');
  });
});
