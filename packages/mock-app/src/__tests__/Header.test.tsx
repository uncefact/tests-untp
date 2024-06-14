import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { createMemoryHistory } from 'history';
import { Router as RouterDom } from 'react-router-dom';

import Header from '../components/Header/Header';

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

    expect(screen.getByText('Red meat')).toBeInTheDocument();
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
    const linkElement = screen.getByText('Feedlot');
    fireEvent.click(linkElement);

    expect(history.location.pathname).toBe('/feedlot');
  });
});
