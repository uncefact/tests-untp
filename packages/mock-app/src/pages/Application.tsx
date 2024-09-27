import React from 'react';
import { Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { convertStringToPath } from '../utils';
import { IApp, IFeature } from '../types/common.types';

export interface IApplication {
  app: IApp;
}

const Application = ({ app }: IApplication) => {
  const renderFeatures = (app: IApp) => {
    const parentPath = `/${convertStringToPath(app.name)}`;

    return app.features.map((feature: IFeature) => {
      const childPath = `${parentPath}/${convertStringToPath(feature.name)}`;
      return (
        <Button
          sx={{
            color: 'primary.typography',
            '&:hover': {
              filter: 'brightness(0.9)',
            },
          }}
          key={childPath}
          variant='contained'
          component={Link}
          to={childPath}
        >
          {feature.name}
        </Button>
      );
    });
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
      {renderFeatures(app)}
    </Box>
  );
};

export default Application;
