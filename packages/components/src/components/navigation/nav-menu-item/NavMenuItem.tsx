import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import React from "react";

export interface NavMenuItemConfig {
  id: string;
  label: string;
  icon?: string | React.ReactNode;
  isExpandable?: boolean;
  subItems?: NavMenuItemConfig[];
}

interface NavMenuItemProps {
  label: string;
  icon?: string | React.ReactNode;
  onClick?: () => void;
  className?: string;
  isActive?: boolean;
  isExpandable?: boolean;
  isExpanded?: boolean;
  isSubItem?: boolean;
}

/**
 * NavMenuItem component for rendering navigation menu items.
 *
 * Theme tokens used:
 * - bg-nav-item-active: Background color for active state
 * - bg-nav-item-hover: Background color for hover state
 * - text-nav-item-foreground-active: Text color for active state
 * - text-nav-item-foreground-inactive: Text color for inactive state
 *
 * You can override these with custom colors via the className prop,
 * e.g., className="bg-sidebar-primary text-sidebar-primary-foreground"
 *
 * Test IDs:
 * - nav-menu-item-{label}: Main button element (label is lowercased and spaces replaced with hyphens)
 * - nav-menu-item-{label}-icon: Icon element (when icon prop is provided)
 * - nav-menu-item-{label}-chevron: Chevron icon (when isExpandable is true)
 *
 */
export function NavMenuItem({
  label,
  icon,
  onClick,
  className,
  isActive = false,
  isExpandable = false,
  isExpanded = false,
  isSubItem = false,
}: NavMenuItemProps) {
  const testId = label.toLowerCase().replace(/\s+/g, "-");

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full p-2 rounded inline-flex justify-between items-center transition-colors cursor-pointer",
        isActive
          ? "bg-nav-item-active"
          : "hover:bg-nav-item-hover",
        isSubItem && "pl-10",
        className,
      )}
      data-testid={`nav-menu-item-${testId}`}
    >
      <div className="flex justify-start items-center gap-2">
        {icon && (
          typeof icon === 'string' ? (
            <img
              src={icon}
              alt=""
              className={cn(
                "w-6 h-6 shrink-0",
                isActive ? "brightness-0 invert" : ""
              )}
              style={!isActive ? { filter: "brightness(0) saturate(100%) invert(17%) sepia(0%) saturate(0%) hue-rotate(202deg) brightness(95%) contrast(91%)" } : undefined}
              aria-hidden="true"
              data-testid={`nav-menu-item-${testId}-icon`}
            />
          ) : (
            <div
              className={cn(
                "w-6 h-6 shrink-0 flex items-center justify-center",
                isActive ? "text-nav-item-foreground-active" : "text-nav-item-foreground-inactive"
              )}
              aria-hidden="true"
              data-testid={`nav-menu-item-${testId}-icon`}
            >
              {icon}
            </div>
          )
        )}
        <span className={cn(
          "text-base font-normal font-roboto leading-snug",
          isActive ? "!text-nav-item-foreground-active" : "text-nav-item-foreground-inactive"
        )}>
          {label}
        </span>
      </div>
      {isExpandable && (
        <ChevronDown
          className={cn(
            "w-5 h-5 shrink-0 transition-transform",
            isActive ? "!text-nav-item-foreground-active" : "text-nav-item-foreground-inactive",
            isExpanded && "rotate-180"
          )}
          data-testid={`nav-menu-item-${testId}-chevron`}
        />
      )}
    </button>
  );
}
