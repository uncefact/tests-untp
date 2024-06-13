import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
import { IStyles } from '../../types/common.types';

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

  const [open, setOpen] = useState(false);
  const [headerBrandInfo, setHeaderBrandInfo] = useState(initialHeaderBrandInfo);
  const [styles, setStyles] = useState<IStyles>({
    primaryColor: appConfig.styles.primaryColor,
    secondaryColor: appConfig.styles.secondaryColor,
    tertiaryColor: appConfig.styles.tertiaryColor,
    menuIconColor: appConfig.styles.menuIconColor,
  });
  const [scanningStyles] = useState({
    primaryColor: 'yellow',
    secondaryColor: 'white',
    tertiaryColor: 'black',
  });

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

    setStyles(subAppStyles?.styles ?? appConfig.styles);

    const defaultHeader = ['/', '/404'];
    if (defaultHeader.includes(path)) {
      setHeaderBrandInfo(initialHeaderBrandInfo);
      setStyles(appConfig.styles);
    }

    if (path === '/scanning') {
      setStyles(scanningStyles);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const renderSidebarElements = (configApp: ConfigAppType, scanningRoute: string, scanningStyles: IStyles) => {
    const menuItems = configApp.apps.map((app: any) => {
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

    return renderSidebarElements(appConfig, scanningRoute, scanningStyles);
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
              <MenuIcon sx={{ color: styles.menuIconColor }} />
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
                  color: appConfig.styles.secondaryColor,
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
