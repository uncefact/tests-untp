import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AppBar, Toolbar, Typography, Container, Stack, Box, IconButton, Menu, MenuItem, Button } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import appConfig from '../../constants/app-config.json';
import { convertStringToPath } from '../../utils';

function Header() {
  const [anchorElNav, setAnchorElNav] = useState<null | HTMLElement>(null);

  /**
   * open nav menu on mobile.
   */
  const handleOpenMobileNavMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorElNav(event.currentTarget);
  };

  /**
   * close nav menu on mobile.
   */
  const handleCloseMobileNavMenu = () => {
    setAnchorElNav(null);
  };

  const renderMenuByScreenType = (screenType: string) => {
    return appConfig.apps.map((app) => {
      const route = `/${convertStringToPath(app.name)}`;

      if (screenType === 'mobile') {
        return (
          <MenuItem key={route} onClick={handleCloseMobileNavMenu}>
            <Typography
              textAlign='center'
              component={Link}
              to={route}
              sx={{ textDecoration: 'none', color: 'inherit' }}
            >
              {app.name}
            </Typography>
          </MenuItem>
        );
      }

      return (
        <Button key={route} component={Link} to={route} sx={{ color: '#000000', display: 'block' }}>
          {app.name}
        </Button>
      );
    });
  };

  return (
    <AppBar sx={{ background: '#ffffff' }}>
      <Container maxWidth='xl'>
        <Toolbar disableGutters>
          {/* Logo on desktop or tablet */}
          {/* <Stack
            component={Link}
            to='/'
            sx={{
              textDecoration: 'none',
              display: { xs: 'none', md: 'flex' },
              alignItems: 'center',
              flexDirection: 'row',
              mr: 2,
            }}
          >
            <Typography
              variant='h6'
              sx={{
                color: '#000000',
              }}
            >
              Ag
            </Typography>
            <Typography
              variant='h6'
              sx={{
                color: '#15728d',
              }}
            >
              Trace
            </Typography>
          </Stack> */}
          {/* Menu on mobile */}
          <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' } }} data-testid='menu'>
            <IconButton
              data-testid='icon-button'
              size='small'
              aria-controls='menu-appbar'
              aria-haspopup='true'
              onClick={handleOpenMobileNavMenu}
              color='inherit'
            >
              <MenuIcon sx={{ color: '#000000' }} />
            </IconButton>
            <Menu
              data-testid='menu-appbar'
              id='menu-appbar'
              anchorEl={anchorElNav}
              anchorOrigin={{
                vertical: 'bottom',
                horizontal: 'left',
              }}
              keepMounted
              transformOrigin={{
                vertical: 'top',
                horizontal: 'left',
              }}
              open={Boolean(anchorElNav)}
              onClose={handleCloseMobileNavMenu}
              sx={{
                display: { xs: 'block', md: 'none' },
              }}
            >
              {renderMenuByScreenType('mobile')}
            </Menu>
          </Box>
          {/* Logo on mobile */}
          {/* <Stack
            component={Link}
            to='/'
            sx={{
              flexGrow: 1,
              textDecoration: 'none',
              display: { xs: 'flex', md: 'none' },
              flexDirection: 'row',
              margin: 'auto',
            }}
          >
            <Typography
              variant='h6'
              sx={{
                color: '#000000',
              }}
            >
              Ag
            </Typography>
            <Typography
              variant='h6'
              sx={{
                color: '#15728d',
              }}
            >
              Trace
            </Typography>
          </Stack> */}
          {/* Menu item on  desktop or tablet */}
          <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }} data-testid='menu-desktop'>
            {renderMenuByScreenType('desktop')}
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export default Header;
