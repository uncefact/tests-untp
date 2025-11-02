"use client";

import { cn } from "@/lib/utils";
import { SidebarHeader as CustomSidebarHeader } from "./header";
import { SidebarFooter as CustomSidebarFooter } from "./footer";
import {
  NavMenu,
  type NavMenuItemConfig,
  type MoreOptionGroup,
  SidebarContent,
  SidebarFooter as ShadcnSidebarFooter,
  SidebarHeader as ShadcnSidebarHeader,
  type User,
} from "@mock-app/components";
import { SidebarSkeleton } from "./skeleton";

interface SidebarProps {
  user: User;
  menuGroups: MoreOptionGroup[];
  logo: string | React.ReactNode;
  onLogoClick: () => void;
  navItems: NavMenuItemConfig[];
  selectedNavId?: string;
  onNavClick?: (navId: string) => void;
  isLoading?: boolean;
  hideHeader?: boolean;
  className?: string;
  autoCollapseInactive?: boolean;
}

export function Sidebar({
  user,
  menuGroups,
  logo,
  onLogoClick,
  navItems,
  selectedNavId,
  onNavClick,
  isLoading = false,
  hideHeader = false,
  className,
  autoCollapseInactive = true,
}: SidebarProps) {
  if (isLoading) {
    return <SidebarSkeleton hideHeader={hideHeader} className={className} />;
  }

  return (
    <aside
      className={cn(
        "w-72 h-full px-6 py-7 bg-sidebar flex flex-col justify-between items-start overflow-hidden",
        className,
      )}
      data-testid="sidebar"
    >
      <ShadcnSidebarHeader className="self-stretch p-0 gap-8">
        {!hideHeader && <CustomSidebarHeader logo={logo} onLogoClick={onLogoClick} />}

        <SidebarContent className="p-0 gap-0">
          <NavMenu
            items={navItems}
            selectedNavId={selectedNavId}
            onNavClick={onNavClick}
            autoCollapseInactive={autoCollapseInactive}
          />
        </SidebarContent>
      </ShadcnSidebarHeader>

      <ShadcnSidebarFooter className="p-0 min-w-0 w-full">
        <CustomSidebarFooter user={user} menuGroups={menuGroups} />
      </ShadcnSidebarFooter>
    </aside>
  );
}
