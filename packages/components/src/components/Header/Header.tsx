import React, { useState, MouseEvent } from 'react';
import { AppBar, Toolbar, Typography, Container, Stack, Box, IconButton, Menu, MenuItem, Button } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';
import { BrowserRouter, Link } from 'react-router-dom';

interface IProps {
  logoTitle?: string;
  logoTitleColor?: string;
  backgroundColor?: string;
  routerLinks: { title: string; path: string }[];
}

/**
 * Header component is used to display the header and navigation to other pages
 */
export const Header = ({ routerLinks, logoTitle = 'Logo', logoTitleColor = '#000', backgroundColor = '#fff' }: IProps) => {
  const [anchorElNav, setAnchorElNav] = useState<null | HTMLElement>(null);

  /**
   * open nav menu on mobile.
   */
  const handleOpenNavMenu = (event: MouseEvent<HTMLElement>) => {
    setAnchorElNav(event.currentTarget);
  };

  /**
   * close nav menu on mobile.
   */
  const handleCloseNavMenu = () => {
    setAnchorElNav(null);
  };

  return (
    <BrowserRouter>
      <AppBar data-testid="header" sx={{ background: backgroundColor }}>
        <Container maxWidth="xl">
          <Toolbar disableGutters>
            {/* Logo on desktop or tablet */}
            <Stack
              component={Link}
              to="/"
              sx={{
                textDecoration: 'none',
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center',
                flexDirection: 'row',
                mr: 2,
              }}
            >
              <Typography
                data-testid="logo"
                variant="h6"
                sx={{
                  color: logoTitleColor,
                }}
              >
                {logoTitle}
              </Typography>
            </Stack>
            {/* Menu on mobile */}
            <Box sx={{ flexGrow: 1, display: { xs: 'flex', md: 'none' } }} data-testid="menu">
              <IconButton
                data-testid="icon-button"
                size="small"
                aria-controls="menu-appbar"
                aria-haspopup="true"
                onClick={handleOpenNavMenu}
                color="inherit"
              >
                <MenuIcon sx={{ color: logoTitleColor }} />
              </IconButton>
              <Menu
                data-testid="menu-appbar"
                id="menu-appbar"
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
                onClose={handleCloseNavMenu}
                sx={{
                  display: { xs: 'block', md: 'none' },
                }}
              >
                {routerLinks.map((page) => (
                  <MenuItem key={page.title} onClick={handleCloseNavMenu}>
                    <Typography
                      textAlign="center"
                      component={Link}
                      to={page.path}
                      sx={{ textDecoration: 'none', color: 'inherit' }}
                    >
                      {page.title}
                    </Typography>
                  </MenuItem>
                ))}
              </Menu>
            </Box>
            {/* Logo on mobile */}
            <Stack
              component={Link}
              to="/"
              sx={{
                flexGrow: 1,
                textDecoration: 'none',
                display: { xs: 'flex', md: 'none' },
                flexDirection: 'row',
                margin: 'auto',
              }}
            >
              <Typography
                variant="h6"
                sx={{
                  color: logoTitleColor,
                }}
              >
                {logoTitle}
              </Typography>
            </Stack>
            {/* Menu item on  desktop or tablet */}
            <Box sx={{ flexGrow: 1, display: { xs: 'none', md: 'flex' } }} data-testid="menu-desktop">
              {routerLinks.map((page) => (
                <Button
                  key={page.title}
                  component={Link}
                  to={page.path}
                  sx={{ color: logoTitleColor, display: 'block' }}
                >
                  {page.title}
                </Button>
              ))}
            </Box>
          </Toolbar>
        </Container>
      </AppBar>
    </BrowserRouter>
  );
};
