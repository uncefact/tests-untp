import React from 'react';
import { Box, Typography } from '@mui/material';

interface IProps {
  textColor?: string;
  backgroundColor?: string;
}

/**
 * Footer component is used to display the footer
 */
export const Footer = ({ textColor = '#000', backgroundColor = '#fff' }: IProps) => {
  const currentYear = new Date().getFullYear();

  return (
    <Box
      sx={{
        textAlign: 'center',
        position: 'fixed',
        bottom: 0,
        width: '100%',
        color: textColor,
        backgroundColor,
      }}
    >
      <Typography>Copyright © {currentYear}</Typography>
    </Box>
  );
};
