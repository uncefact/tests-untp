import { cn } from "@/lib/utils";
import { ReactNode } from "react";

interface SidebarHeaderProps {
  className?: string;
  logo: string | ReactNode;
  onLogoClick?: () => void;
}

export function SidebarHeader({
  className,
  logo,
  onLogoClick,
}: SidebarHeaderProps) {
  const logoElement = typeof logo === "string" ? (
    <img
      src={logo}
      alt="Logo"
      className={cn("w-12 h-12", className)}
      data-testid="sidebar-header-logo"
    />
  ) : (
    logo
  );

  if (onLogoClick) {
    return (
      <button
        onClick={onLogoClick}
        className="cursor-pointer text-left w-full"
        data-testid="sidebar-header"
      >
        {logoElement}
      </button>
    );
  }

  return (
    <div data-testid="sidebar-header" className="text-left w-full">
      {logoElement}
    </div>
  );
}
