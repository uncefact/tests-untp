'use client';

import { createContext, useContext } from 'react';

export interface RuntimeConfig {
  headerTitle: string;
}

const defaultConfig: RuntimeConfig = {
  headerTitle: 'UNTP Playground',
};

const RuntimeConfigContext = createContext<RuntimeConfig>(defaultConfig);

export function RuntimeConfigProvider({ config, children }: { config: RuntimeConfig; children: React.ReactNode }) {
  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}

export { defaultConfig };
