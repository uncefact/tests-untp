import * as React from 'react';
import { Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { convertStringToPath } from '../utils';
import appConfig from '../constants/app-config.json';

const Home = () => {
  const renderApps = () => {
    const apps = appConfig.apps.map((configApp) => {
      const path = `/${convertStringToPath(configApp.name)}`;
      return (
        <Button
          sx={{
            background: appConfig.styles.primaryColor,
            color: appConfig.styles.secondaryColor,
            '&:hover': {
              backgroundColor: appConfig.styles.primaryColor,
              filter: 'brightness(0.9)',
            }
          }}
          key={path}
          variant='contained'
          component={Link}
          to={path}
          onClick={() => {
            sessionStorage.setItem('nameLink', configApp.name);
          }}
        >
          {configApp.name}
        </Button>
      );
    });

    apps.push(
      <Button
        sx={{
          background: appConfig.styles.primaryColor,
          color: appConfig.styles.secondaryColor,
          '&:hover': {
            backgroundColor: appConfig.styles.primaryColor,
            filter: 'brightness(0.9)',
          }
        }}
        key={'/scanning'}
        variant='contained'
        component={Link}
        to={'/scanning'}
        onClick={() => sessionStorage.setItem('nameLink', 'Scanning')}
      >
        Scanning
      </Button>,
    );

    return apps;
  };

  const renderGenericFeature = () => {
    const generateFeature = appConfig.generalFeatures.map((feature) => {
      const path = `/${convertStringToPath(feature.name)}`;
      return (
        <Button
          sx={{
            background: appConfig.styles.primaryColor,
            color: appConfig.styles.secondaryColor,
            '&:hover': {
              backgroundColor: appConfig.styles.primaryColor,
              filter: 'brightness(0.9)',
            }
          }}
          key={path}
          variant='contained'
          component={Link}
          to={path}
          onClick={() => sessionStorage.setItem('nameLink', feature.name)}
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
