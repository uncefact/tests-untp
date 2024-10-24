import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Router as RouterDom } from 'react-router-dom';
import appConfig from './mocks/app-config.mock.json';
import { useGlobalContext } from '../hooks/GlobalContext';

import Header from '../components/Header/Header';

// Mock the appConfig to provide test data
jest.mock('../../src/constants/app-config.json', () => appConfig, { virtual: true });

jest.mock('../hooks/GlobalContext', () => ({
  useGlobalContext: jest.fn(() => ({
    theme: {
      selectedTheme: { primaryColor: '#000000', secondaryColor: '#000000', tertiaryColor: '#000000' },
      setSelectedTheme: jest
        .fn()
        .mockImplementation(() => ({ primaryColor: '#000000', secondaryColor: '#000000', tertiaryColor: '#000000' })),
    },
  })),
}));

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useLocation: () => ({
    pathname: 'localhost:3000/',
  }),
}));

describe('Header', () => {
  it('should render the header', () => {
    const history = createMemoryHistory({ initialEntries: ['/'] });

    render(
      <RouterDom location={history.location} navigator={history}>
        <Header />
      </RouterDom>,
    );

    expect(screen.getByText(appConfig.name)).toBeInTheDocument();
  });

  it('should open sidebar menu in header', () => {
    const history = createMemoryHistory({ initialEntries: ['/'] });

    render(
      <RouterDom location={history.location} navigator={history}>
        <Header />
      </RouterDom>,
    );

    fireEvent.click(screen.getByTestId('icon-button'));
    expect(screen.getByTestId('menu')).toBeInTheDocument();
  });

  it('should redirect to sub app when clicking on button on Home page', () => {
    const history = createMemoryHistory({ initialEntries: ['/'] });

    render(
      <RouterDom location={history.location} navigator={history}>
        <Header />
      </RouterDom>,
    );

    fireEvent.click(screen.getByTestId('icon-button'));
    const linkElement = screen.getByTestId('app-name');
    fireEvent.click(linkElement);

    expect(history.location.pathname).toBe('/');
  });
});
