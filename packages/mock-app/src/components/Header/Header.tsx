import React, { useContext, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { JSX } from 'react/jsx-runtime';
import {
  AppBar,
  Toolbar,
  Typography,
  Container,
  Box,
  IconButton,
  Stack,
  Avatar,
  Divider,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Drawer,
  ListItemIcon,
  Button,
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import SearchIcon from '@mui/icons-material/Search';
import DialpadIcon from '@mui/icons-material/Dialpad';

import appConfig from '../../constants/app-config.json';
import { convertPathToString, convertStringToPath } from '../../utils';
import { ThemeContext } from '../../hooks/ThemContext';

type ConfigAppType = typeof appConfig;

const initialHeaderBrandInfo = {
  name: appConfig.name,
  assets: {
    logo: '',
  },
};

const ICON_SIZE = '30px';

const iconConfig: { [key: string]: JSX.Element } = {
  Scanning: <SearchIcon sx={{ fontSize: ICON_SIZE }} />,
  'General features': <DialpadIcon sx={{ fontSize: ICON_SIZE }} />,
};

function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toggleTheme } = useContext<any>(ThemeContext);

  const [open, setOpen] = useState(false);
  const [headerBrandInfo, setHeaderBrandInfo] = useState(initialHeaderBrandInfo);

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  useEffect(() => {
    const path = location.pathname;
    const nameLink = convertPathToString(path ?? '');
    const subAppStyles =
      appConfig.apps.find((app) => app.name.toLocaleLowerCase() === nameLink.toLocaleLowerCase()) ??
      appConfig.generalFeatures.find((app) => app.name.toLocaleLowerCase() === nameLink.toLocaleLowerCase());

    setHeaderBrandInfo({
      name: convertPathToString(path ?? ''),
      assets: {
        logo: subAppStyles && 'assets' in subAppStyles ? subAppStyles?.assets?.logo : '',
      },
    });

    toggleTheme(subAppStyles?.styles);

    const defaultHeader = ['/', '/404'];
    if (defaultHeader.includes(path)) {
      setHeaderBrandInfo(initialHeaderBrandInfo);
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const renderAvatar = (value: any) => {
    if (value?.assets?.logo) {
      return <Avatar sx={{ marginRight: '10px' }} alt='Company logo' src={value.assets.logo} />;
    }

    return iconConfig[value.name];
  };

  const SideBarComponent = ({ app, route }: { app: any; route: string }) => (
    <List>
      <ListItem key={app.name} disablePadding>
        <ListItemButton
          component={Link}
          to={route}
          onClick={() => {
            toggleDrawer(false);
          }}
        >
          <ListItemIcon>{renderAvatar(app)}</ListItemIcon>
          <ListItemText primary={app.name} />
        </ListItemButton>
      </ListItem>
    </List>
  );

  const renderSidebarElements = (configApp: ConfigAppType, scanningRoute: string) => {
    const menuItems = configApp.apps.map((app: any) => {
      const route = `/${convertStringToPath(app.name)}`;
      return <SideBarComponent app={app} route={route} />;
    });

    // Add Scanning menu item
    menuItems.push(<SideBarComponent app={{ name: 'Scanning' }} route={scanningRoute} />);

    const menuItemGeneratorFeatures = appConfig.generalFeatures.map((app: any) => {
      const path = `/${convertStringToPath(app.name)}`;
      return <SideBarComponent app={app} route={path} />;
    });

    menuItems.push(...menuItemGeneratorFeatures);

    return menuItems;
  };

  const renderSidebar = () => {
    const scanningRoute = '/scanning';

    return renderSidebarElements(appConfig, scanningRoute);
  };

  const renderHeaderText = (appConfig: ConfigAppType, headerTitle: typeof initialHeaderBrandInfo) => {
    const app = appConfig.apps.find((app) => app.name === headerTitle.name);
    return (
      <Typography
        variant='h5'
        sx={{
          color: app ? app.styles.secondaryColor : appConfig.styles.secondaryColor,
          fontSize: {
            xs: '20px',
            md: '24px',
            lg: '24px',
          },
          cursor: 'pointer',
        }}
        onClick={() => handleClickHeaderText(headerBrandInfo.name ?? appConfig.name)}
      >
        {headerBrandInfo.name ?? appConfig.name}
      </Typography>
    );
  };

  const handleClickHeaderText = (title: string) => {
    if (title === appConfig.name) {
      navigate('/');
      return;
    }

    const path = `/${convertStringToPath(title)}`;
    navigate(path);
  };

  return (
    <AppBar component='nav'>
      <Container maxWidth='xl'>
        <Toolbar disableGutters>
          <Box sx={{ flexGrow: 1, display: { xs: 'flex' } }} data-testid='menu'>
            <IconButton
              data-testid='icon-button'
              size='small'
              aria-controls='menu-appbar'
              aria-haspopup='true'
              onClick={toggleDrawer(true)}
            >
              <MenuIcon
                sx={{
                  color: 'primary.typography',
                }}
              />
            </IconButton>

            <Drawer open={open} onClose={toggleDrawer(false)}>
              <Box sx={{ width: 250 }} role='presentation' onClick={toggleDrawer(!open)}>
                <Stack
                  component={Link}
                  to='/'
                  sx={{
                    textDecoration: 'none',
                    textAlign: 'center',
                    padding: '10px',
                  }}
                >
                  <Typography variant='h5'>{appConfig.name}</Typography>
                </Stack>
                <Divider />
                {renderSidebar()}
              </Box>
            </Drawer>

            <Stack
              sx={{
                textDecoration: 'none',
                alignItems: 'center',
                flexDirection: 'row',
                margin: '2px',
              }}
            >
              {/* Render avatar */}
              {headerBrandInfo.assets?.logo && (
                <Avatar sx={{ marginRight: '10px' }} alt='Company logo' src={headerBrandInfo.assets.logo} />
              )}
              {renderHeaderText(appConfig, headerBrandInfo)}
            </Stack>
          </Box>

          <Stack
            component={Link}
            to='/'
            sx={{
              textDecoration: 'none',
              alignItems: 'end',
              flexDirection: 'row',
              margin: '2px',
            }}
          >
            {!headerBrandInfo.name.includes(appConfig.name) && (
              <Button
                sx={{
                  color: 'primary.typography',
                }}
              >
                Back to Home
              </Button>
            )}
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export default Header;
