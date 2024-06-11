import React, { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
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
import { convertStringToPath } from '../../utils';
import { IStyles } from '../../types/common.types';

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

  const [open, setOpen] = useState(false);
  const [headerBrandInfo, setHeaderBrandInfo] = useState(initialHeaderBrandInfo);
  const [styles, setStyles] = useState<IStyles>({
    primaryColor: appConfig.styles.primaryColor,
    secondaryColor: appConfig.styles.secondaryColor,
    tertiaryColor: appConfig.styles.tertiaryColor,
  });

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  useEffect(() => {
    const path = location.pathname;
    const getNameLinkFromSesion = sessionStorage.getItem('nameLink');

    if (getNameLinkFromSesion) {
      setHeaderBrandInfo({
        name: getNameLinkFromSesion,
        assets: {
          logo: '',
        },
      });
      sessionStorage.removeItem('nameLink');
    }

    if (path === '/') {
      setHeaderBrandInfo(initialHeaderBrandInfo);
      setStyles(appConfig.styles);
    }
  }, [location.pathname]);

  const renderAvatar = (value: any) => {
    if (value?.assets?.logo) {
      return <Avatar sx={{ marginRight: '10px' }} alt='Company logo' src={value.assets.logo} />;
    }

    return iconConfig[value.name];
  };

  const SideBarComponent = ({ app, route, styles }: { app: any; route: string; styles: IStyles }) => (
    <List>
      <ListItem key={app.name} disablePadding>
        <ListItemButton
          component={Link}
          to={route}
          onClick={() => {
            toggleDrawer(false);
            setStyles(styles);
            setHeaderBrandInfo({
              name: app.name,
              assets: {
                logo: app.assets?.logo,
              },
            });
          }}
        >
          <ListItemIcon>{renderAvatar(app)}</ListItemIcon>
          <ListItemText primary={app.name} />
        </ListItemButton>
      </ListItem>
    </List>
  );

  const renderSidebarElements = (apps: any[], scanningRoute: string, scanningStyles: IStyles) => {
    const menuItems = apps.map((app: any) => {
      const route = `/${convertStringToPath(app.name)}`;
      return <SideBarComponent app={app} route={route} styles={app.styles} />;
    });

    // Add Scanning menu item
    menuItems.push(<SideBarComponent app={{ name: 'Scanning' }} route={scanningRoute} styles={scanningStyles} />);

    const menuItemGeneratorFeatures = appConfig.generalFeatures.map((app) => {
      const path = `/${convertStringToPath(app.name)}`;
      return <SideBarComponent app={app} route={path} styles={app.styles} />;
    });

    menuItems.push(...menuItemGeneratorFeatures);

    return menuItems;
  };

  const renderSidebar = () => {
    const scanningRoute = '/scanning';
    const scanningStyles: IStyles = {
      primaryColor: 'rgb(41, 171, 48)',
      secondaryColor: 'white',
      tertiaryColor: 'black',
    };

    return renderSidebarElements(appConfig.apps, scanningRoute, scanningStyles);
  };

  return (
    <AppBar component='nav' sx={{ background: styles.primaryColor }}>
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
              <MenuIcon sx={{ color: styles.secondaryColor }} />
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
                  <Typography
                    variant='h5'
                    sx={{
                      color: appConfig.styles.secondaryColor,
                    }}
                  >
                    {appConfig.name}
                  </Typography>
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
                margin: {
                  xs: 'auto',
                  md: '2px',
                  lg: '2px',
                },
              }}
            >
              {/* Render avatar */}
              {headerBrandInfo.assets?.logo && (
                <Avatar sx={{ marginRight: '10px' }} alt='Company logo' src={headerBrandInfo.assets.logo} />
              )}
              <Typography
                variant='h5'
                sx={{
                  color: appConfig.styles.secondaryColor,
                  fontSize: {
                    xs: '20px',
                    md: '24px',
                    lg: '24px',
                  },
                }}
              >
                {headerBrandInfo.name ?? appConfig.name}
              </Typography>
            </Stack>
          </Box>

          <Stack
            component={Link}
            to='/'
            sx={{
              textDecoration: 'none',
              alignItems: 'end',
              flexDirection: 'row',
              margin: {
                xs: 'auto',
                md: '2px',
                lg: '2px',
              },
            }}
          >
            <Button
              sx={{
                color: appConfig.styles.secondaryColor,
              }}
            >
              Back to Home
            </Button>
          </Stack>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export default Header;
