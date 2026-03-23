'use client';

import { createContext, useContext, useMemo, ReactNode } from 'react';
import type { Did } from '@/lib/prisma/generated';
import type { PaginationMeta } from '@/lib/api/pagination';
import { listDids } from '@/lib/api/services/did.service';
import { usePaginatedFetch } from '@/hooks/use-paginated-fetch';

interface DidContextType {
  dids: Did[];
  managedDids: Did[];
  selfManagedDids: Did[];
  defaultDid: Did | null;
  pagination: PaginationMeta | null;
  isLoading: boolean;
  error: Error | null;
  refresh: () => void;
  goToPage: (offset: number) => void;
  setPageSize: (limit: number) => void;
}

const DidContext = createContext<DidContextType | undefined>(undefined);

interface DidProviderProps {
  children: ReactNode;
}

export function DidProvider({ children }: DidProviderProps) {
  const {
    data: dids,
    pagination,
    isLoading,
    error,
    refresh,
    goToPage,
    setPageSize,
  } = usePaginatedFetch(({ limit, offset }) => listDids({ limit, offset }), { fetchOnMount: true });

  const managedDids = useMemo(() => dids.filter((d) => d.type === 'MANAGED'), [dids]);
  const selfManagedDids = useMemo(() => dids.filter((d) => d.type === 'SELF_MANAGED'), [dids]);
  const defaultDid = useMemo(() => dids.find((d) => d.isDefault) ?? null, [dids]);

  const value: DidContextType = useMemo(
    () => ({
      dids,
      managedDids,
      selfManagedDids,
      defaultDid,
      pagination,
      isLoading,
      error,
      refresh,
      goToPage,
      setPageSize,
    }),
    [dids, managedDids, selfManagedDids, defaultDid, pagination, isLoading, error, refresh, goToPage, setPageSize],
  );

  return <DidContext.Provider value={value}>{children}</DidContext.Provider>;
}

export function useDids() {
  const context = useContext(DidContext);
  if (context === undefined) {
    throw new Error('useDids must be used within a DidProvider');
  }
  return context;
}
