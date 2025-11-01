import type { Meta, StoryObj } from "@storybook/react-webpack5";
import { MoreOptions } from "./MoreOptions";

const meta: Meta<typeof MoreOptions> = {
  title: "Components/Utility/MoreOptions",
  component: MoreOptions,
  parameters: {
    layout: "centered",
  },
  decorators: [
    (Story) => {
      return (
        <div className="bg-background p-8">
          <Story />
        </div>
      );
    },
  ],
  tags: ['autodocs'],
};

export default meta;
type Story = StoryObj<typeof meta>;

// Single group with multiple options
export const Default: Story = {
  args: {
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
          {
            label: "Archive",
            onClick: () => console.log("Archive clicked"),
          },
        ],
      },
    ],
  },
};

// Multiple groups with separator
export const MultipleGroups: Story = {
  args: {
    groups: [
      {
        options: [
          {
            label: "View details",
            onClick: () => console.log("View details clicked"),
          },
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
        ],
      },
      {
        options: [
          {
            label: "Download",
            onClick: () => console.log("Download clicked"),
          },
          {
            label: "Share",
            onClick: () => console.log("Share clicked"),
          },
        ],
      },
    ],
  },
};

// With disabled option
export const WithDisabledOption: Story = {
  args: {
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
            disabled: true,
          },
          {
            label: "Archive",
            onClick: () => console.log("Archive clicked"),
          },
        ],
      },
    ],
  },
};

// With destructive action
export const WithDestructiveAction: Story = {
  args: {
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
      {
        options: [
          {
            label: "Delete",
            onClick: () => console.log("Delete clicked"),
            destructive: true,
          },
        ],
      },
    ],
  },
};

// With icon and text
export const WithIconAndText: Story = {
  args: {
    groups: [
      {
        options: [
          {
            label: (
              <div className="flex items-center gap-2 text-foreground">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"
                    fill="currentColor"
                  />
                </svg>
                <span>Edit</span>
              </div>
            ),
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: (
              <div className="flex items-center gap-2 text-foreground">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"
                    fill="currentColor"
                  />
                </svg>
                <span>Duplicate</span>
              </div>
            ),
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
    ],
  },
};

// Custom positioning - align start
export const AlignStart: Story = {
  args: {
    align: "start",
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
    ],
  },
};

// Custom positioning - side top
export const SideTop: Story = {
  args: {
    side: "top",
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
    ],
  },
};

// Custom positioning - larger side offset
export const LargerSideOffset: Story = {
  args: {
    sideOffset: 16,
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
    ],
  },
};

// Custom positioning - align offset
export const WithAlignOffset: Story = {
  args: {
    alignOffset: -20,
    groups: [
      {
        options: [
          {
            label: "Edit",
            onClick: () => console.log("Edit clicked"),
          },
          {
            label: "Duplicate",
            onClick: () => console.log("Duplicate clicked"),
          },
        ],
      },
    ],
  },
};
