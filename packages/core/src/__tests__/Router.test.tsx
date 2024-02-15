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
    name: 'Red meat',
    styles: {
      primaryColor: '#fff',
      secondaryColor: 'white',
      tertiaryColor: 'black',
    },
    apps: [
      {
        name: 'Farm',
        features: [{ name: 'Issue DLP' }],
        styles: {
          primaryColor: '#fff',
          secondaryColor: 'white',
          tertiaryColor: 'black',
        },
      },
      {
        name: 'Feedlot',
        features: [{ name: 'Import DLP' }, { name: 'Feed Cattle' }, { name: 'Sell Cattle' }],
        styles: {
          primaryColor: '#fff',
          secondaryColor: 'white',
          tertiaryColor: 'black',
        },
      },
      {
        name: 'Processor',
        features: [{ name: 'Import DLP' }, { name: 'Process Cattle' }],
        styles: {
          primaryColor: '#fff',
          secondaryColor: 'white',
          tertiaryColor: 'black',
        },
      },
    ],
  }),
  { virtual: true },
);

jest.mock('@mock-app/components', () => ({
  Footer: jest.fn()
}));

describe('Router Component', () => {
  // Test case to check if the Router redirects to the 404 page for an invalid route
  it('should renders route incorrectly', () => {
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

  // Test case to verifies the rendering of the home page
  it('should renders home page', () => {
    // Create a memory history object with an initial entry of the home route ('/')
    const history = createMemoryHistory({ initialEntries: ['/'] });

    // Render the Router component with the provided history
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    // Find all buttons with text matching 'Farm', 'Feedlot', and 'Processor'
    const farmButton = screen.getAllByText(/Farm/i);
    const feedlotButton = screen.getAllByText(/Feedlot/i);
    const processorButton = screen.getAllByText(/Processor/i);

    // Assert that all buttons for the respective apps are displayed on the Home page
    expect(farmButton).not.toBeNull();
    expect(feedlotButton).not.toBeNull();
    expect(processorButton).not.toBeNull();
  });

  // Test case to check if clicking on a link in the Header navigates to the correct route
  it('should renders header and navigato to Farm component correctly', () => {
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
  it('should renders route subpath correctly', () => {
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
