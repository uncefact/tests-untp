import { cn } from "@/lib/utils";
import { MoreOptions, UserProfile, type User, type MoreOptionGroup } from "@reference-implementation/components";

interface SidebarFooterProps {
  user: User;
  menuGroups: MoreOptionGroup[];
  className?: string;
}

export function SidebarFooter({ user, menuGroups, className }: SidebarFooterProps) {
  return (
    <div
      className={cn(
        'w-full min-w-0 pt-4 border-t border-sidebar-border flex justify-between items-center gap-3',
        className,
      )}
      data-testid='sidebar-footer'
    >
      <UserProfile user={user} className='flex-1' />
      <MoreOptions testId='sidebar-menu' groups={menuGroups} />
    </div>
  );
}
