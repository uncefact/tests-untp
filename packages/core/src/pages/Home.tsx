import React from 'react';
import { Box, Button } from '@mui/material';
import { Link } from 'react-router-dom';
import { convertStringToPath } from '../utils';

export interface IHome {
  app?: IApp;
}

export interface IApp {
  name: string;
  type: string;
  features: IFeature[];
}

export interface IFeature {
  name: string;
  id: string;
  services: string[];
}

function Home({ app }: IHome) {
  const renderFeatures = (app: IApp) => {
    const parentPath = `/${convertStringToPath(app.name)}`;

    return app.features.map((feature: IFeature) => {
      const childPath = `${parentPath}/${convertStringToPath(feature.name)}`;

      return (
        <Button key={childPath} variant='contained' component={Link} to={childPath}>
          {feature.name}
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
      {app ? renderFeatures(app) : 'Features'}
    </Box>
  );
}

export default Home;
