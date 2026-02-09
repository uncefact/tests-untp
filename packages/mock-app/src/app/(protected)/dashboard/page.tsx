'use client';

import { Box, Typography, Paper, Stack } from '@mui/material';
import { useSession } from 'next-auth/react';

export default function DashboardPage() {
  const { data: session } = useSession();

  return (
    <Box sx={{ padding: 4 }}>
      <Stack spacing={3}>
        <Typography variant='h3' component='h1'>
          Dashboard
        </Typography>

        <Typography variant='body1' color='text.secondary'>
          This is a protected dashboard. Only authenticated users can access this page.
        </Typography>

        {session?.user && (
          <Paper
            elevation={2}
            sx={{
              padding: 3,
              backgroundColor: '#f5f5f5',
            }}
          >
            <Typography variant='h5' component='h2' gutterBottom>
              User Information
            </Typography>
            <Stack spacing={1}>
              <Typography variant='body1'>
                <strong>Name:</strong> {session.user.name || 'N/A'}
              </Typography>
              <Typography variant='body1'>
                <strong>Email:</strong> {session.user.email || 'N/A'}
              </Typography>
              <Typography variant='body1'>
                <strong>User ID:</strong> {session.user.id || 'N/A'}
              </Typography>
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
