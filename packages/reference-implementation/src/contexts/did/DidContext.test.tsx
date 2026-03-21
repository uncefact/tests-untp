import { render, screen, waitFor } from '@testing-library/react';

import type { Did } from '@/lib/prisma/generated';
import type { PaginatedResponse } from '@/lib/api/pagination';
import { DidProvider, useDids } from './DidContext';

// Mock the DID service
jest.mock('@/lib/api/services/did.service');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { listDids } = require('@/lib/api/services/did.service') as {
  listDids: jest.Mock;
};

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const baseDid: Did = {
  id: 'did-001',
  tenantId: 'tenant-001',
  did: 'did:web:example.com:managed',
  type: 'MANAGED' as Did['type'],
  method: 'DID_WEB' as Did['method'],
  name: 'Managed DID',
  description: 'A managed DID',
  keyId: 'key-001',
  status: 'VERIFIED' as Did['status'],
  isDefault: true,
  createdAt: new Date('2026-01-15T10:00:00Z'),
  updatedAt: new Date('2026-02-20T14:30:00Z'),
  serviceInstanceId: 'svc-inst-001',
};

const selfManagedDid: Did = {
  id: 'did-002',
  tenantId: 'tenant-001',
  did: 'did:web:my-domain.com',
  type: 'SELF_MANAGED' as Did['type'],
  method: 'DID_WEB' as Did['method'],
  name: 'Self-Managed DID',
  description: null,
  keyId: 'key-002',
  status: 'UNVERIFIED' as Did['status'],
  isDefault: false,
  createdAt: new Date('2026-02-01T08:00:00Z'),
  updatedAt: new Date('2026-02-01T08:00:00Z'),
  serviceInstanceId: null,
};

const defaultTypeDid: Did = {
  id: 'did-003',
  tenantId: 'tenant-001',
  did: 'did:web:example.com:default',
  type: 'DEFAULT' as Did['type'],
  method: 'DID_WEB' as Did['method'],
  name: 'Default Type DID',
  description: null,
  keyId: 'key-003',
  status: 'VERIFIED' as Did['status'],
  isDefault: false,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  serviceInstanceId: null,
};

function createPaginatedResponse(dids: Did[]): PaginatedResponse<Did> {
  return {
    data: dids,
    pagination: {
      total: dids.length,
      limit: 20,
      offset: 0,
      hasMore: false,
    },
  };
}

// ---------------------------------------------------------------------------
// Test component
// ---------------------------------------------------------------------------

function TestComponent() {
  const { dids, managedDids, selfManagedDids, defaultDid, isLoading, error, refresh, goToPage, setPageSize } =
    useDids();

  return (
    <div>
      <div data-testid='loading'>{isLoading ? 'loading' : 'not-loading'}</div>
      <div data-testid='error'>{error ? error.message : 'no-error'}</div>
      <div data-testid='dids-count'>{dids.length}</div>
      <div data-testid='managed-count'>{managedDids.length}</div>
      <div data-testid='self-managed-count'>{selfManagedDids.length}</div>
      <div data-testid='default-did'>{defaultDid?.id ?? 'none'}</div>
      <div data-testid='did-ids'>{dids.map((d) => d.id).join(',')}</div>
      <button data-testid='refresh-btn' onClick={refresh}>
        Refresh
      </button>
      <button data-testid='go-to-page-btn' onClick={() => goToPage(20)}>
        Page 2
      </button>
      <button data-testid='set-page-size-btn' onClick={() => setPageSize(50)}>
        Size 50
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DidContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('DidProvider', () => {
    it('fetches DIDs on mount and provides them via context', async () => {
      listDids.mockResolvedValue(createPaginatedResponse([baseDid, selfManagedDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      expect(screen.getByTestId('dids-count')).toHaveTextContent('2');
      expect(screen.getByTestId('did-ids')).toHaveTextContent('did-001,did-002');
      expect(listDids).toHaveBeenCalledWith({ limit: 20, offset: 0 });
    });

    it('categorises DIDs into managed, self-managed, and default', async () => {
      listDids.mockResolvedValue(createPaginatedResponse([baseDid, selfManagedDid, defaultTypeDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      expect(screen.getByTestId('managed-count')).toHaveTextContent('1');
      expect(screen.getByTestId('self-managed-count')).toHaveTextContent('1');
      // defaultDid is baseDid (isDefault: true), not the DEFAULT type DID
      expect(screen.getByTestId('default-did')).toHaveTextContent('did-001');
    });

    it('returns null for defaultDid when no DID has isDefault: true', async () => {
      const nonDefaultDid = { ...baseDid, isDefault: false };
      listDids.mockResolvedValue(createPaginatedResponse([nonDefaultDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      expect(screen.getByTestId('default-did')).toHaveTextContent('none');
    });

    it('returns isLoading true with empty arrays while fetching', async () => {
      let resolveFetch!: (value: PaginatedResponse<Did>) => void;
      listDids.mockReturnValue(
        new Promise<PaginatedResponse<Did>>((resolve) => {
          resolveFetch = resolve;
        }),
      );

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('loading');
      });

      expect(screen.getByTestId('dids-count')).toHaveTextContent('0');
      expect(screen.getByTestId('managed-count')).toHaveTextContent('0');
      expect(screen.getByTestId('self-managed-count')).toHaveTextContent('0');

      // Resolve to clean up
      resolveFetch(createPaginatedResponse([]));

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });
    });

    it('sets error and returns empty arrays when fetch fails', async () => {
      listDids.mockRejectedValue(new Error('API unavailable'));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      expect(screen.getByTestId('error')).toHaveTextContent('API unavailable');
      expect(screen.getByTestId('dids-count')).toHaveTextContent('0');
    });

    it('re-fetches when refresh is called', async () => {
      listDids.mockResolvedValue(createPaginatedResponse([baseDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      expect(listDids).toHaveBeenCalledTimes(1);

      screen.getByTestId('refresh-btn').click();

      await waitFor(() => {
        expect(listDids).toHaveBeenCalledTimes(2);
      });
    });

    it('fetches with new offset when goToPage is called', async () => {
      listDids.mockResolvedValue(createPaginatedResponse([baseDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      screen.getByTestId('go-to-page-btn').click();

      await waitFor(() => {
        expect(listDids).toHaveBeenCalledWith({ limit: 20, offset: 20 });
      });
    });

    it('fetches with new limit and resets offset when setPageSize is called', async () => {
      listDids.mockResolvedValue(createPaginatedResponse([baseDid]));

      render(
        <DidProvider>
          <TestComponent />
        </DidProvider>,
      );

      await waitFor(() => {
        expect(screen.getByTestId('loading')).toHaveTextContent('not-loading');
      });

      screen.getByTestId('set-page-size-btn').click();

      await waitFor(() => {
        expect(listDids).toHaveBeenCalledWith({ limit: 50, offset: 0 });
      });
    });
  });

  describe('useDids', () => {
    it('throws error when used outside DidProvider', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      function OutsideComponent() {
        useDids();
        return null;
      }

      expect(() => {
        render(<OutsideComponent />);
      }).toThrow('useDids must be used within a DidProvider');

      consoleErrorSpy.mockRestore();
    });
  });
});
