'use client';

import { createContext, useContext } from 'react';

export interface RuntimeConfig {
  headerTitle: string;
  verificationServiceUrl: string;
  verificationServiceToken: string;
}

const defaultConfig: RuntimeConfig = {
  headerTitle: 'UNTP Playground',
  verificationServiceUrl: 'https://vckit.untp.showthething.com/agent/routeVerificationCredential',
  verificationServiceToken: 'test123',
};

const RuntimeConfigContext = createContext<RuntimeConfig>(defaultConfig);

export function RuntimeConfigProvider({
  config,
  children,
}: {
  config: RuntimeConfig;
  children: React.ReactNode;
}) {
  return <RuntimeConfigContext.Provider value={config}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig() {
  return useContext(RuntimeConfigContext);
}

export { defaultConfig };
