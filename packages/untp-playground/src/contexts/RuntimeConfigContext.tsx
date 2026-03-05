'use client';

import { createContext, useContext } from 'react';

export interface RuntimeConfig {
  headerTitle: string;
  specUrl: string;
  testSuiteUrl: string;
}

const defaultConfig: RuntimeConfig = {
  headerTitle: 'UNTP Playground',
  specUrl: 'https://untp.unece.org',
  testSuiteUrl: 'https://github.com/uncefact/tests-untp',
};

const RuntimeConfigContext = createContext<RuntimeConfig>(defaultConfig);

export function RuntimeConfigProvider({ config, children }: { config: RuntimeConfig; children: React.ReactNode }) {
  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}

export { defaultConfig };
