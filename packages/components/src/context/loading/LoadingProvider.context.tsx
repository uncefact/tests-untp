import React, { useState } from 'react';

import { noop } from '../../utils/index.js';
import { LoadingIndicator } from '../../components/LoadingIndicator/LoadingIndicator.js';

export type LoadingContextValue = {
  isLoading: boolean;
  showLoading: typeof noop;
  hideLoading: typeof noop;
};

export const LoadingContext = React.createContext<LoadingContextValue>({
  isLoading: false,
  showLoading: () => noop,
  hideLoading: () => noop,
});

export type LoadingProviderProps = {
  children: React.ReactNode;
};

export function LoadingProvider(props: LoadingProviderProps) {
  const [isLoading, setIsLoading] = useState(false);

  const loadingValue = React.useMemo(() => {
    return {
      isLoading,
      showLoading: () => setIsLoading(true),
      hideLoading: () => setIsLoading(false),
    };
  }, [isLoading]);

  return (
    <LoadingContext.Provider value={loadingValue}>
      {isLoading && <LoadingIndicator />}
      {props.children}
    </LoadingContext.Provider>
  );
}

export const useLoading = () => {
  const context = React.useContext(LoadingContext);

  if (!context) {
    throw new Error('useLoading must be used within LoadingProvider');
  }

  return context;
};
