import React from 'react';
import { Container, Typography } from '@mui/material';

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
    <Container
      sx={{
        marginTop: '40px',
        textAlign: 'center',
        color: textColor,
        backgroundColor,
      }}
    >
      <Typography>Copyright © {currentYear}</Typography>
    </Container>
  );
};
