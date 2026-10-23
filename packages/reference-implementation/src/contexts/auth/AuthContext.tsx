'use client';

import { createContext, useContext, ReactNode } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { User } from '@reference-implementation/components';
import { getLogoutUrl } from '@/lib/auth/actions';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { data: session, status } = useSession();

  const isLoading = status === 'loading';
  const isAuthenticated = status === 'authenticated' && !!session;

  const user: User | null = isAuthenticated
    ? {
        name: session?.user?.name || '',
        email: session?.user?.email || '',
        roles: [], // TODO: Fetch org roles from organization endpoint.
      }
    : null;

  const logout = async () => {
    try {
      // Step 1: Get the OIDC logout URL before clearing the session (server action reads id_token)
      const logoutUrl = await getLogoutUrl();

      // Step 2: Sign out from NextAuth (clear app session)
      await signOut({ redirect: false });

      // Step 3: Redirect to OIDC provider logout
      if (logoutUrl) {
        window.location.href = logoutUrl;
      } else {
        // Fallback: just redirect to home
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const value: AuthContextType = {
    user,
    isLoading,
    isAuthenticated,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
