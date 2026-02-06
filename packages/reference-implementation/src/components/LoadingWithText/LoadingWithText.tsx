import { Box, CircularProgress, Typography } from '@mui/material';

/**
 *
 * LoadingWithText component is used to display a loading spinner with text
 */
const LoadingWithText = ({ text }: { text: string }) => {
  return (
    <Box
      sx={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',

        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
      }}
    >
      <CircularProgress />
      <Box
        sx={{
          marginTop: '1rem',
        }}
      >
        <Typography sx={{ textAlign: 'center' }}>{text}</Typography>
      </Box>
    </Box>
  );
};

export default LoadingWithText;
