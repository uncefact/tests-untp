'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
import { useGlobalContext } from '../../hooks/GlobalContext';
import { IApp } from '@/types/common.types';

type ConfigAppType = typeof appConfig;
type ConfigAppItem = ConfigAppType['apps'][number];

const initialHeaderBrandInfo = {
  name: appConfig.name,
  assets: {
    logo: '',
  },
};

const ICON_SIZE = '30px';

const iconConfig: { [key: string]: React.ReactNode } = {
  Scanning: <SearchIcon sx={{ fontSize: ICON_SIZE }} />,
  'General features': <DialpadIcon sx={{ fontSize: ICON_SIZE }} />,
};

function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { theme } = useGlobalContext();

  const [open, setOpen] = useState(false);
  const [headerBrandInfo, setHeaderBrandInfo] = useState({
    name: '',
    assets: {
      logo: '',
    },
  });

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  const renderAvatar = (value: { assets?: { logo?: string }; name: string }) => {
    if (value?.assets?.logo) {
      return <Avatar sx={{ marginRight: '10px' }} alt='Company logo' src={value.assets.logo} />;
    }

    return iconConfig[value.name];
  };

  const SideBarComponent = ({ app, route }: { app: Partial<IApp>; route: string }) => (
    <List>
      <ListItem key={app.name} disablePadding>
        <ListItemButton
          component={Link}
          href={route}
          onClick={() => {
            toggleDrawer(false);
          }}
        >
          <ListItemIcon>{renderAvatar(app as IApp)}</ListItemIcon>
          <ListItemText primary={app.name} />
        </ListItemButton>
      </ListItem>
    </List>
  );

  const renderSidebarElements = (configApp: ConfigAppType, scanningRoute: string) => {
    const menuItems = configApp.apps.map((app: ConfigAppItem) => {
      const route = `/${convertStringToPath(app.name ?? '')}`;
      const sidebarApp: Partial<IApp> = {
        name: app.name,
        assets: {
          logo: app.assets.logo,
          brandTitle: app.assets.brandTitle,
          passportVC: '',
          transactionEventVC: '',
        },
      };
      return <SideBarComponent key={app.name} app={sidebarApp} route={route} />;
    });

    // Add Scanning menu item
    menuItems.push(<SideBarComponent key='Scanning' app={{ name: 'Scanning' }} route={scanningRoute} />);

    const menuItemGeneratorFeatures = appConfig.generalFeatures.map((app) => {
      const path = `/${convertStringToPath(app.name ?? '')}`;
      return <SideBarComponent key={app.name} app={app as Partial<IApp>} route={path} />;
    });

    menuItems.push(...menuItemGeneratorFeatures);

    return menuItems;
  };

  const renderSidebar = () => {
    const scanningRoute = '/scanning';

    return renderSidebarElements(appConfig, scanningRoute);
  };

  const renderHeaderText = (appConfig: ConfigAppType) => {
    return (
      <Typography
        variant='h5'
        sx={{
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
      router.push('/');
      return;
    }

    const path = `/${convertStringToPath(title)}`;
    router.push(path);
  };

  useEffect(() => {
    const nameLink = convertPathToString(pathname ?? '');
    const subAppStyles =
      appConfig.apps.find((app) => app.name.toLocaleLowerCase() === nameLink.toLocaleLowerCase()) ??
      appConfig.generalFeatures.find((app) => app.name.toLocaleLowerCase() === nameLink.toLocaleLowerCase());

    setHeaderBrandInfo({
      name: convertPathToString(pathname ?? ''),
      assets: {
        logo:
          subAppStyles && 'assets' in subAppStyles
            ? (subAppStyles as { assets?: { logo?: string } })?.assets?.logo ?? ''
            : '',
      },
    });

    if (theme?.setSelectedTheme) {
      if (subAppStyles?.styles) {
        theme?.setSelectedTheme(subAppStyles?.styles);
      } else {
        theme?.setSelectedTheme(appConfig.styles);
        setHeaderBrandInfo(initialHeaderBrandInfo);
      }
    }
  }, [pathname]);

  return theme?.selectedTheme?.primaryColor &&
    theme?.selectedTheme?.secondaryColor &&
    theme?.selectedTheme?.tertiaryColor ? (
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
                  data-testid='app-name'
                  component={Link}
                  href='/'
                  sx={{
                    textDecoration: 'none',
                    textAlign: 'center',
                    padding: '10px',
                  }}
                >
                  <Typography variant='h5' sx={{ color: 'black' }}>
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
              {renderHeaderText(appConfig)}
            </Stack>
          </Box>

          <Stack
            component={Link}
            href='/'
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
  ) : null;
}

export default Header;
