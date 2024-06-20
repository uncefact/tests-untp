import { createTheme } from '@mui/material';

const ThemeSettings = (styles: any = {}) => {
  const baseMode = {
    palette: {
      primary: {
        main: styles?.primaryColor,
        typography: styles?.tertiaryColor,
        contrastText: styles?.tertiaryColor, // text color, intended to contrast with main
      },
    },

    typography: styles?.tertiaryColor,
  };

  const theme = createTheme(baseMode);
  return theme;
};
export { ThemeSettings };
