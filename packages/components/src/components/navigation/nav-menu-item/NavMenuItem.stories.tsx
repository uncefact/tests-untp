import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { NavMenuItem } from "./NavMenuItem";
import { Settings, ChevronRight, FileCheck } from "lucide-react";

const meta = {
  title: "Components/Navigation/NavMenuItem",
  component: NavMenuItem,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => {
      return (
        <div className="bg-background p-8" style={{ width: "288px" }}>
          <Story />
        </div>
      );
    },
  ],
  argTypes: {
    label: {
      control: "text",
      description: "The label text for the nav item",
    },
    icon: {
      control: false,
      description: "Icon as a URL string or React component (optional)",
    },
    onClick: {
      action: "clicked",
      description: "Callback when nav item is clicked",
    },
    className: {
      control: "text",
      description: "Additional CSS classes to apply",
    },
    isActive: {
      control: "boolean",
      description: "Whether the nav item is currently active/selected",
    },
    isExpandable: {
      control: "boolean",
      description: "Whether the nav item can be expanded (shows chevron icon)",
    },
    isExpanded: {
      control: "boolean",
      description: "Whether the nav item is currently expanded (only applies if isExpandable is true)",
    },
    isSubItem: {
      control: "boolean",
      description: "Whether this is a sub-item (applies additional left padding)",
    },
  },
} satisfies Meta<typeof NavMenuItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {
    label: "Configuration",
    icon: <Settings />,
  },
};

export const Active: Story = {
  args: {
    label: "Configuration",
    icon: <Settings />,
    isActive: true,
  },
};

export const WithReactIcon: Story = {
  args: {
    label: "Settings",
    icon: <Settings />,
  },
};

export const WithoutIcon: Story = {
  args: {
    label: "Text Only Item",
  },
};

export const Expandable: Story = {
  args: {
    label: "Resources",
    icon: <ChevronRight />,
    isExpandable: true,
    isExpanded: false,
  },
};

export const ExpandableExpanded: Story = {
  args: {
    label: "Resources",
    icon: <ChevronRight />,
    isExpandable: true,
    isExpanded: true,
  },
};

export const SubItem: Story = {
  args: {
    label: "Sub Item",
    icon: <FileCheck />,
    isSubItem: true,
  },
};
