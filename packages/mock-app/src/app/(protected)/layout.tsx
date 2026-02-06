'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { type NavMenuItemConfig, type MoreOptionGroup, Loader } from '@mock-app/components';
import { AuthProvider, useAuth } from '@/contexts/auth';
import { Sidebar, MobileSidebar } from '@/components/sidebar';
import { LogOut } from 'lucide-react';

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

function ProtectedContent({ children }: { children: React.ReactNode }) {
  const { user, isLoading: authLoading, isAuthenticated, logout } = useAuth();
  const router = useRouter();

  const [selectedNavId, setSelectedNavId] = useState<string>('credentials');

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
    // TODO: Implement navigation logic as pages become available.
    setSelectedNavId(navId);
    console.log('Navigation clicked:', navId);
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

  return (
    <div className='flex h-screen overflow-hidden'>
      {/* Mobile Sidebar/Navbar - hidden on desktop */}
      <div className='md:hidden'>
        <MobileSidebar
          user={userForSidebar}
          menuGroups={menuGroups}
          logo={logo}
          onLogoClick={handleLogoClick}
          navItems={navItems}
          selectedNavId={selectedNavId}
          onNavClick={handleNavClick}
          isLoading={isLoading}
        />
      </div>

      {/* Desktop Sidebar - hidden on mobile */}
      <div className='hidden md:block'>
        <Sidebar
          user={userForSidebar}
          menuGroups={menuGroups}
          logo={logo}
          onLogoClick={handleLogoClick}
          navItems={navItems}
          selectedNavId={selectedNavId}
          onNavClick={handleNavClick}
          isLoading={isLoading}
        />
      </div>

      <main className='flex-1 overflow-auto pt-16 md:pt-0'>
        <div className='px-6 py-6'>
          {isLoading ? <Loader size={60} text='Loading...' className='min-h-[calc(100vh-3rem)]' /> : children}
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
