'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppBar, Toolbar, Typography, Container, Box, IconButton, Stack, Divider, Drawer } from '@mui/material';
import { Menu as MenuIcon } from '@mui/icons-material';

const APP_NAME = 'UNTP Reference Implementation';

function Header() {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpen(newOpen);
  };

  return (
    <AppBar component='nav'>
      <Container maxWidth='xl'>
        <Toolbar disableGutters>
          <Box sx={{ flexGrow: 1, display: { xs: 'flex' } }}>
            <IconButton
              data-testid='icon-button'
              size='small'
              aria-controls='menu-appbar'
              aria-haspopup='true'
              onClick={toggleDrawer(true)}
            >
              <MenuIcon sx={{ color: 'primary.typography' }} />
            </IconButton>

            <Drawer open={open} onClose={toggleDrawer(false)}>
              <Box sx={{ width: 250 }} role='presentation' onClick={toggleDrawer(false)}>
                <Stack component={Link} href='/' sx={{ textDecoration: 'none', textAlign: 'center', padding: '10px' }}>
                  <Typography variant='h5' sx={{ color: 'black' }}>
                    {APP_NAME}
                  </Typography>
                </Stack>
                <Divider />
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
              <Typography
                variant='h5'
                sx={{
                  fontSize: { xs: '20px', md: '24px', lg: '24px' },
                  cursor: 'pointer',
                }}
                onClick={() => router.push('/')}
              >
                {APP_NAME}
              </Typography>
            </Stack>
          </Box>
        </Toolbar>
      </Container>
    </AppBar>
  );
}

export default Header;
