import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { Router as RouterDom } from 'react-router-dom';
import { createMemoryHistory } from 'history';
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
    generalFeatures: [
      {
        name: 'General features',
        type: '',
        styles: {
          primaryColor: 'rgb(255, 207, 7)',
          secondaryColor: 'black',
          tertiaryColor: 'black',
        },
        features: [
          {
            name: 'Conformity Credential',
            id: 'conformity_credential',
            components: [
              {
                name: 'ConformityCredential',
                type: '',
                props: {
                  credentialRequestConfigs: [
                    {
                      url: 'http://example.com/deforestation-free-assessment',
                      params: {},
                      options: {
                        headers: [],
                        method: 'POST',
                      },
                      credentialName: 'Deforestation Free Assessment',
                      credentialPath: '/body/credentil',
                      appOnly: 'Farm',
                    },
                  ],
                  storedCredentialsConfig: {
                    url: 'https://storage.example.com',
                    params: {},
                    options: {
                      bucket: 'bucket-stored-example',
                    },
                    type: 's3',
                  },
                },
              },
            ],
            services: [],
          },
        ],
      },
    ],
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
    scanningApp: {
      config: {
        path: '/scanning',
        styles: {
          primaryColor: 'rgb(41, 171, 48)',
          secondaryColor: 'white',
          tertiaryColor: 'black',
        },
      },
      provider: 'gs1',
      providerVerifyUrl: 'https://verified-by-gs1.agtrace.showthething.com',
      services: {
        certificationInfo: 'https://gs1.org/voc/certificationInfo',
        verificationService: 'https://gs1.org/voc/verificationService',
        serviceInfo: 'https://gs1.org/voc/serviceInfo',
      },
      defaultVerificationServiceLink: {
        title: 'Default Verification Service',
        context: 'Default Verification Service',
        type: 'application/json',
        href: 'https://verify.agtrace.showthething.com/credentials/verify',
        hreflang: ['en'],
      },
    },
  }),
  { virtual: true },
);

jest.mock('@mock-app/components', () => ({
  Footer: jest.fn(),
}));

jest.mock('@mock-app/services', () => ({
  services: jest.fn(),
}));

jest.mock('@veramo/utils', () => ({
  computeEntryHash: jest.fn(),
}));

jest.mock('@vckit/renderer', () => ({
  Renderer: jest.fn(),
  WebRenderingTemplate2022: jest.fn(),
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
