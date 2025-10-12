'use client';

import * as React from 'react';
import Link from 'next/link';
import { Box, Button } from '@mui/material';
import { convertStringToPath } from '../utils';
import appConfig from '../constants/app-config.json';

const Home = () => {
  const renderApps = () => {
    const apps = appConfig.apps.map((configApp) => {
      const path = `/${convertStringToPath(configApp.name)}`;
      return (
        <Button
          sx={{
            color: 'primary.typography',
            '&:hover': {
              filter: 'brightness(0.9)',
            },
          }}
          key={path}
          variant="contained"
          component={Link}
          href={path}
        >
          {configApp.name}
        </Button>
      );
    });

    apps.push(
      <Button
        sx={{
          color: 'primary.typography',
          '&:hover': {
            filter: 'brightness(0.9)',
          },
        }}
        key={'/scanning'}
        variant="contained"
        component={Link}
        href={'/scanning'}
      >
        Scanning
      </Button>
    );

    return apps;
  };

  const renderGenericFeature = () => {
    const generateFeature = appConfig.generalFeatures.map((feature) => {
      const path = `/${convertStringToPath(feature.name)}`;
      return (
        <Button
          sx={{
            color: 'primary.typography',
            '&:hover': {
              filter: 'brightness(0.9)',
            },
          }}
          key={path}
          variant="contained"
          component={Link}
          href={path}
        >
          {feature.name}
        </Button>
      );
    });

    return generateFeature;
  };

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',

        height: '100%',
        width: '100%',
        gap: '24px',

        paddingTop: '50px',
        marginTop: '64px',
      }}
    >
      {renderApps()}
      {renderGenericFeature()}
    </Box>
  );
};

export default Home;
