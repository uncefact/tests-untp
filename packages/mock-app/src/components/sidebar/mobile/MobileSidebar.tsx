import { useState } from "react";
import { cn } from "@/lib/utils";
import { Sidebar } from "../Sidebar";
import type { User, NavMenuItemConfig, MoreOptionGroup } from "@mock-app/components";

interface MobileSidebarProps {
  user: User;
  menuGroups: MoreOptionGroup[];
  logo: string | React.ReactNode;
  onLogoClick: () => void;
  navItems: NavMenuItemConfig[];
  selectedNavId?: string;
  onNavClick?: (navId: string) => void;
  isLoading?: boolean;
  className?: string;
  autoCollapseInactive?: boolean;
}

export function MobileSidebar(props: MobileSidebarProps) {
  const [isOpen, setIsOpen] = useState(false);

  const handleNavClick = (navId: string) => {
    props.onNavClick?.(navId);
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile Navbar */}
      <nav
        className={cn(
          "fixed top-0 left-0 right-0 z-50 bg-background border-b border-border",
          props.className,
        )}
        data-testid="mobile-navbar"
      >
        <div className="flex justify-between items-center px-4 py-4">
          {/* Logo */}
          <button
            onClick={props.onLogoClick}
            className="cursor-pointer"
            data-testid="mobile-navbar-logo"
          >
            {typeof props.logo === "string" ? (
              <img
                src={props.logo}
                alt="Logo"
                className="w-12 h-12"
              />
            ) : (
              props.logo
            )}
          </button>

          {/* Hamburger button */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-2 rounded-md hover:bg-accent transition-colors"
            aria-label={isOpen ? "Close menu" : "Open menu"}
            data-testid="mobile-sidebar-toggle"
          >
            <div className="w-6 h-6 flex flex-col justify-center items-center gap-1.5">
              <span
                className={cn(
                  "w-full h-0.5 bg-foreground transition-transform duration-200 origin-center",
                  isOpen && "rotate-45 translate-y-2",
                )}
              />
              <span
                className={cn(
                  "w-full h-0.5 bg-foreground transition-opacity duration-200",
                  isOpen && "opacity-0",
                )}
              />
              <span
                className={cn(
                  "w-full h-0.5 bg-foreground transition-transform duration-200 origin-center",
                  isOpen && "-rotate-45 -translate-y-2",
                )}
              />
            </div>
          </button>
        </div>
      </nav>

      {/* Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setIsOpen(false)}
          data-testid="mobile-sidebar-overlay"
        />
      )}

      {/* Sidebar - shows skeleton inside when loading */}
      <div
        className={cn(
          "fixed top-16 left-0 z-40 transition-transform duration-300 ease-in-out h-[calc(100vh-4rem)]",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
        data-testid="mobile-sidebar"
      >
        <Sidebar
          user={props.user}
          menuGroups={props.menuGroups}
          logo={props.logo}
          onLogoClick={props.onLogoClick}
          navItems={props.navItems}
          selectedNavId={props.selectedNavId}
          onNavClick={handleNavClick}
          isLoading={props.isLoading}
          hideHeader={true}
          autoCollapseInactive={props.autoCollapseInactive}
        />
      </div>
    </>
  );
}
