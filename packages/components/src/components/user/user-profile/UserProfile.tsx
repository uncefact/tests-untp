import { cn } from "@/lib/utils";
import type { User } from "@/types";

interface UserProfileProps {
  user: User;
  className?: string;
}

/**
 * UserProfile component for displaying user information.
 *
 * Theme tokens used:
 * - bg-user-profile: Background color (transparent by default to blend with container)
 * - text-user-profile-foreground: Text color for name and email
 *
 * You can override these with custom colors via the className prop.
 *
 * Test IDs:
 * - user-profile: Main container element
 * - user-profile-name: User's name element
 * - user-profile-email: User's email element
 */
export function UserProfile({ user, className }: UserProfileProps) {
  return (
    <div
      className={cn("flex items-center gap-2 bg-user-profile", className)}
      data-testid="user-profile"
    >
      <div className="flex flex-col min-w-0 flex-1">
        <div
          className="text-user-profile-foreground text-base font-normal leading-7 truncate"
          data-testid="user-profile-name"
        >
          {user.name}
        </div>
        <div
          className="text-user-profile-foreground text-sm font-normal leading-none truncate"
          data-testid="user-profile-email"
        >
          {user.email}
        </div>
      </div>
    </div>
  );
}
