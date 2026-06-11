'use client';

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { type NavMenuItemConfig, type MoreOptionGroup, Loader } from '@reference-implementation/components';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { DidProvider } from '@/contexts/did/DidContext';
import { Sidebar, MobileSidebar } from '@/components/sidebar';
import { LogOut } from 'lucide-react';

// Navigation is hidden until the pages it links to exist; flip to true to reinstate (#715).
const SHOW_NAVIGATION = false;

interface ProtectedLayoutProps {
  children: React.ReactNode;
}

const navItems: NavMenuItemConfig[] = [
  {
    id: 'credentials',
    label: 'Credentials',
    icon: '/icons/license.svg',
    isExpandable: true,
    // Sub-items will be dynamically loaded in the future (facilities)
  },
  {
    id: 'configuration',
    label: 'Configuration',
    icon: '/icons/settings.svg',
    isExpandable: true,
    subItems: [
      {
        id: 'scheme-identifiers',
        label: 'Scheme Identifiers',
        icon: '/icons/admin_panel_settings.svg',
      },
      {
        id: 'dids',
        label: 'DIDs',
        icon: '/icons/key_vertical.svg',
      },
      {
        id: 'master-data',
        label: 'Master data',
        icon: '/icons/dashboard.svg',
      },
    ],
  },
  {
    id: 'resources',
    label: 'Resources',
    icon: '/icons/book_ribbon.svg',
    isExternal: true,
  },
];

/**
 * Maps nav item IDs to their corresponding route paths.
 * Extend this map as new pages are added.
 */
const NAV_ROUTE_MAP: Record<string, string> = {
  dids: '/configuration/dids',
};

/**
 * Derives the reverse mapping from route paths to nav item IDs,
 * sorted by path length descending so longer (more specific) paths match first.
 */
const ROUTE_TO_NAV_ENTRIES = Object.entries(NAV_ROUTE_MAP)
  .map(([navId, path]) => ({ navId, path }))
  .sort((a, b) => b.path.length - a.path.length);

function resolveNavIdFromPathname(pathname: string): string | undefined {
  const match = ROUTE_TO_NAV_ENTRIES.find(({ path }) => pathname.startsWith(path));
  return match?.navId;
}

function ProtectedContent({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const selectedNavId = pathname ? resolveNavIdFromPathname(pathname) : undefined;

  // Redirect to login page if user is not authenticated
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push('/api/auth/signin');
    }
  }, [authLoading, isAuthenticated, router]);

  // Show loading state while authenticating OR while redirecting (not authenticated)
  const isLoading = authLoading || !isAuthenticated;

  // Menu groups for the more options dropdown in the sidebar footer
  const menuGroups: MoreOptionGroup[] = [
    {
      options: [
        {
          label: (
            <span className='flex items-center gap-2'>
              <LogOut className='w-4 h-4' />
              Logout
            </span>
          ),
          onClick: logout,
        },
      ],
    },
  ];

  // Handle navigation click in the sidebar
  const handleNavClick = (navId: string) => {
    const route = NAV_ROUTE_MAP[navId];
    if (route) {
      router.push(route);
    } else if (process.env.NODE_ENV === 'development') {
      console.warn(`No route mapped for nav item "${navId}"`);
    }
  };

  // Handle logo click in the sidebar
  const handleLogoClick = () => {
    router.push('/dashboard');
  };

  // Construct the user object for profile section in the sidebar footer
  const userForSidebar = user || {
    name: '',
    email: '',
    roles: [],
  };

  // Default logo for the sidebar. Will dynamically change based on organization settings.
  const logo = <span className='text-xl font-semibold'>UNTP Reference Implementation</span>;

  const sidebarProps = {
    user: userForSidebar,
    menuGroups,
    logo,
    onLogoClick: handleLogoClick,
    navItems,
    selectedNavId,
    onNavClick: handleNavClick,
    isLoading,
  };

  return (
    <div className='flex h-screen overflow-hidden'>
      {SHOW_NAVIGATION && (
        <>
          {/* Mobile Sidebar/Navbar - hidden on desktop */}
          <div className='md:hidden'>
            <MobileSidebar {...sidebarProps} />
          </div>

          {/* Desktop Sidebar - hidden on mobile */}
          <div className='hidden md:block'>
            <Sidebar {...sidebarProps} />
          </div>
        </>
      )}

      <main className={`flex-1 overflow-auto${SHOW_NAVIGATION ? ' pt-16 md:pt-0' : ''}`}>
        <div className='px-6 py-6'>
          {isLoading ? (
            <Loader size={60} text='Loading...' className='min-h-[calc(100vh-3rem)]' />
          ) : (
            <DidProvider>{children}</DidProvider>
          )}
        </div>
      </main>
    </div>
  );
}

export default function ProtectedLayout({ children }: ProtectedLayoutProps) {
  return (
    <AuthProvider>
      <ProtectedContent>{children}</ProtectedContent>
    </AuthProvider>
  );
}
