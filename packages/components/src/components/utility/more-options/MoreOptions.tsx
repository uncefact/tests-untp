import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ReactNode } from "react";

export interface MoreOption {
  label: string | ReactNode;
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
}

export interface MoreOptionGroup {
  options: MoreOption[];
}

export interface MoreOptionsProps {
  groups: MoreOptionGroup[];
  className?: string;
  testId?: string;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  alignOffset?: number;
}

export function MoreOptions({
  groups,
  className,
  testId = "more-options",
  align = "end",
  side = "bottom",
  sideOffset = 8,
  alignOffset,
}: MoreOptionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center justify-center w-8 h-8 hover:bg-accent rounded-sm cursor-pointer focus:outline-none focus-visible:outline-none",
          className,
        )}
        data-testid={`${testId}-trigger`}
      >
        <svg
          width="6"
          height="20"
          viewBox="0 0 6 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="text-foreground"
          aria-label="More options"
        >
          <path d="M3 20C2.3125 20 1.72396 19.7552 1.23438 19.2656C0.744792 18.776 0.5 18.1875 0.5 17.5C0.5 16.8125 0.744792 16.224 1.23438 15.7344C1.72396 15.2448 2.3125 15 3 15C3.6875 15 4.27604 15.2448 4.76562 15.7344C5.25521 16.224 5.5 16.8125 5.5 17.5C5.5 18.1875 5.25521 18.776 4.76562 19.2656C4.27604 19.7552 3.6875 20 3 20ZM3 12.5C2.3125 12.5 1.72396 12.2552 1.23438 11.7656C0.744792 11.276 0.5 10.6875 0.5 10C0.5 9.3125 0.744792 8.72396 1.23438 8.23438C1.72396 7.74479 2.3125 7.5 3 7.5C3.6875 7.5 4.27604 7.74479 4.76562 8.23438C5.25521 8.72396 5.5 9.3125 5.5 10C5.5 10.6875 5.25521 11.276 4.76562 11.7656C4.27604 12.2552 3.6875 12.5 3 12.5ZM3 5C2.3125 5 1.72396 4.75521 1.23438 4.26562C0.744792 3.77604 0.5 3.1875 0.5 2.5C0.5 1.8125 0.744792 1.22396 1.23438 0.734375C1.72396 0.244792 2.3125 0 3 0C3.6875 0 4.27604 0.244792 4.76562 0.734375C5.25521 1.22396 5.5 1.8125 5.5 2.5C5.5 3.1875 5.25521 3.77604 4.76562 4.26562C4.27604 4.75521 3.6875 5 3 5Z" fill="currentColor"/>
        </svg>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        data-testid={`${testId}-content`}
      >
        {groups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {groupIndex > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              {group.options.map((option, optionIndex) => (
                <DropdownMenuItem
                  key={optionIndex}
                  onClick={option.onClick}
                  disabled={option.disabled}
                  className={cn(
                    "cursor-pointer",
                    option.destructive &&
                    "text-destructive focus:text-destructive",
                  )}
                  data-testid={`${testId}-option-${groupIndex}-${optionIndex}`}
                >
                  {option.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
