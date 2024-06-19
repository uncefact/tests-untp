import { createTheme } from '@mui/material';

const ThemeSettings = (styles: any = {}) => {
  const baseMode = {
    palette: {
      primary: {
        main: styles?.primaryColor,
        typography: styles?.secondaryColor,
      },
    },

    typography: styles?.secondaryColor,
  };

  const theme = createTheme(baseMode);
  return theme;
};
export { ThemeSettings };
