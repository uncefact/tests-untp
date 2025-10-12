import { createTheme } from '@mui/material';
import { IStyles } from '@/types/common.types';

const ThemeSettings = (styles: Partial<IStyles> = {}) => {
  const baseMode = {
    palette: {
      primary: {
        main: styles?.primaryColor ?? '#ffffff',
        contrastText: styles?.tertiaryColor ?? '#ffffff', // text color, intended to contrast with main
      },
    },

    typography: {
      allVariants: {
        color: styles?.tertiaryColor ?? '#ffffff',
      },
    },
  };

  const theme = createTheme(baseMode);
  return theme;
};
export { ThemeSettings };
