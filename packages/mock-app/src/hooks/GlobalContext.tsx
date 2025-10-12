'use client';

import { createContext, Dispatch, useContext } from 'react';

export type Theme = { primaryColor: string; secondaryColor: string; tertiaryColor: string };

type GlobalContextType = {
  theme?: {
    selectedTheme?: Theme;
    setSelectedTheme?: Dispatch<React.SetStateAction<Theme | undefined>>;
  };
};

export const GlobalContext = createContext<GlobalContextType>({});

export const useGlobalContext = () => useContext(GlobalContext);
