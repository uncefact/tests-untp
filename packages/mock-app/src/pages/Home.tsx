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
          sx={{ background: appConfig.styles.primaryColor }}
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
        sx={{ background: appConfig.styles.primaryColor }}
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
    const generateFeature = appConfig.generateFeatures.map((feature) => {
      const path = `/${convertStringToPath(feature.name)}`;
      return (
        <Button
          sx={{ background: appConfig.styles.primaryColor }}
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
      {renderGenericFeature()}
    </Box>
  );
};

export default Home;
