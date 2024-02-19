import React from 'react';
import { Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { convertStringToPath } from '../utils';
import appConfig from '../constants/app-config.json';

const Home = () => {
  const renderApps = () => {
    return appConfig.apps.map((configApp) => {
      const path = `/${convertStringToPath(configApp.name)}`;
      return (
        <Button sx={{ background: appConfig.styles.primaryColor }} key={path} variant='contained' component={Link} to={path}>
          {configApp.name}
        </Button>
      );
    });
  };

  return (
    <Box
      sx={{
        marginTop: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        height: '50vh',
        width: '100%',
        gap: '24px',
      }}
    >
      {renderApps()}
    </Box>
  );
};

export default Home;
