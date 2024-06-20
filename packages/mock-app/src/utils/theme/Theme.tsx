import { createTheme } from '@mui/material';

const ThemeSettings = (styles: any = {}) => {
  const baseMode = {
    palette: {
      primary: {
        main: styles?.primaryColor ?? '#ffffff',
        typography: styles?.tertiaryColor ?? '#ffffff',
        contrastText: styles?.tertiaryColor ?? '#ffffff', // text color, intended to contrast with main
      },
    },

    typography: styles?.tertiaryColor,
  };

  const theme = createTheme(baseMode);
  return theme;
};
export { ThemeSettings };
