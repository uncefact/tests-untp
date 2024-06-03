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
} from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import appConfig from '../../constants/app-config.json';
import { convertStringToPath } from '../../utils';
import { IStyles } from '../../types/common.types';

function Header() {
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [nameLink, setNameLink] = useState(appConfig.name);
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

    if (path === '/') {
      setNameLink(appConfig.name);
      setStyles(appConfig.styles);
    }
  }, [location.pathname]);

  const SideBarComponent = ({ app, route, styles }: { app: any; route: string; styles: IStyles }) => (
    <List>
      <ListItem key={app.name} disablePadding>
        <ListItemButton
          component={Link}
          to={route}
          onClick={() => {
            toggleDrawer(false);
            setStyles(styles);
            setNameLink(app.name);
          }}
        >
          <ListItemIcon>{app.assets?.logo && <Avatar alt='Company logo' src={app.assets.logo} />}</ListItemIcon>
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

    const menuItemGeneratorFeatures = appConfig.generateFeatures.map((app) => {
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
              component={Link}
              to='/'
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
                {nameLink ?? appConfig.name}
              </Typography>
            </Stack>
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export default Header;
