import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Router as RouterDom } from 'react-router-dom';
import { createMemoryHistory } from 'history';
import appConfig from './mocks/app-config.mock.json';
import { Router } from '../components/Router';
import { Home, Scanning, Verify, Application, GenericPage } from '../pages';

// Mock the appConfig to provide test data
jest.mock('../../src/constants/app-config.json', () => appConfig, { virtual: true });
jest.mock('@mock-app/components', () => ({
  Footer: jest.fn(),
}));

jest.mock('@mock-app/services', () => ({
  services: jest.fn(),
}));

jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
}));

jest.mock('../pages', () => ({
  Home: jest.fn().mockReturnValue(<div>Home</div>),
  Scanning: jest.fn().mockReturnValue(<div>Scanning</div>),
  Verify: jest.fn().mockReturnValue(<div>Verify</div>),
  Application: jest.fn().mockReturnValue(<div>Application</div>),
  GenericPage: jest.fn().mockReturnValue(<div>GenericPage</div>),
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

    expect(screen.getByText('Home')).not.toBeNull();
  });

  it('should renders scanning page', () => {
    const history = createMemoryHistory({ initialEntries: ['/scanning'] });
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    expect(screen.getByText('Scanning')).not.toBeNull();
  });

  it('should renders verify page', () => {
    const history = createMemoryHistory({ initialEntries: ['/verify'] });
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    expect(screen.getByText('Verify')).not.toBeNull();
  });

  it('should renders route feature path correctly', () => {
    const history = createMemoryHistory({ initialEntries: ['/orchard-facility'] });
    render(
      <RouterDom location={history.location} navigator={history}>
        <Router />
      </RouterDom>,
    );

    expect(screen.getByText('Application')).not.toBeNull();
  });
});
