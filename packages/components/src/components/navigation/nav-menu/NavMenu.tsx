import { cn } from "@/lib/utils";
import { NavMenuItem, type NavMenuItemConfig } from "../nav-menu-item";
import { useState, useEffect } from "react";

interface NavMenuProps {
  items: NavMenuItemConfig[];
  selectedNavId?: string;
  onNavClick?: (navId: string) => void;
  className?: string;
  autoCollapseInactive?: boolean;
}

/**
 * NavMenu component for rendering a navigation menu with expandable items.
 *
 * Theme tokens used:
 * - bg-nav-menu: Background color for the nav menu container
 * - text-nav-menu-foreground: Text color for the nav menu
 *
 * You can override these with custom colors via the className prop,
 * e.g., className="bg-sidebar-primary text-sidebar-primary-foreground"
 *
 * Test IDs:
 * - nav-menu: Main container element
 *
 */
export function NavMenu({
  items,
  selectedNavId,
  onNavClick,
  className,
  autoCollapseInactive = true,
}: NavMenuProps) {
  // Track which expandable items are expanded
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

  // Auto-expand parent if a sub-item is selected
  useEffect(() => {
    if (selectedNavId) {
      items.forEach((item) => {
        if (item.subItems) {
          const hasSelectedSubItem = item.subItems.some(
            (subItem) => subItem.id === selectedNavId
          );
          if (hasSelectedSubItem) {
            setExpandedItems((prev) => new Set([...prev, item.id]));
          }
        }
      });
    }
  }, [selectedNavId, items]);

  const toggleExpanded = (itemId: string) => {
    setExpandedItems((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(itemId)) {
        newSet.delete(itemId);
      } else {
        newSet.add(itemId);
      }
      return newSet;
    });
  };

  const handleItemClick = (item: NavMenuItemConfig) => {
    if (item.isExpandable) {
      toggleExpanded(item.id);
    } else {
      // When clicking a non-expandable item, auto-collapse if enabled
      if (autoCollapseInactive) {
        setExpandedItems(new Set());
      }
      onNavClick?.(item.id);
    }
  };

  const handleSubItemClick = (subItem: NavMenuItemConfig) => {
    // When clicking a sub-item, auto-collapse other parents if enabled
    if (autoCollapseInactive) {
      // Find which parent contains this sub-item and keep only that one expanded
      const newExpandedItems = new Set<string>();
      items.forEach((item) => {
        if (item.subItems?.some((sub) => sub.id === subItem.id)) {
          newExpandedItems.add(item.id);
        }
      });
      setExpandedItems(newExpandedItems);
    }
    onNavClick?.(subItem.id);
  };

  return (
    <div
      className={cn(
        "self-stretch flex flex-col justify-start items-start gap-2 bg-nav-menu text-nav-menu-foreground",
        className
      )}
      data-testid="nav-menu"
    >
      {items.map((item) => {
        const isExpanded = expandedItems.has(item.id);
        const isActive = selectedNavId === item.id;

        return (
          <div key={item.id} className="w-full">
            <NavMenuItem
              label={item.label}
              icon={item.icon}
              isExpandable={item.isExpandable}
              isExpanded={isExpanded}
              isActive={isActive}
              onClick={() => handleItemClick(item)}
            />

            {item.isExpandable && isExpanded && item.subItems && (
              <>
                {item.subItems.map((subItem) => (
                  <NavMenuItem
                    key={subItem.id}
                    label={subItem.label}
                    icon={subItem.icon}
                    isSubItem
                    isActive={selectedNavId === subItem.id}
                    onClick={() => handleSubItemClick(subItem)}
                  />
                ))}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
