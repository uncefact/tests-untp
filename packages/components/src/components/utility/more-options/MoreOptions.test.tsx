import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MoreOptions } from "./MoreOptions";

describe("MoreOptions", () => {
  const mockOnClick = jest.fn();

  beforeEach(() => {
    mockOnClick.mockClear();
  });

  it("renders trigger button", () => {
    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders more_vert icon", () => {
    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    const icon = screen.getByLabelText("More options");
    expect(icon).toBeInTheDocument();
    expect(icon).toBeInstanceOf(SVGElement);
  });

  it("shows dropdown content when clicked", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    const trigger = screen.getByTestId("more-options-trigger");
    await user.click(trigger);

    expect(screen.getByTestId("more-options-content")).toBeInTheDocument();
  });

  it("renders single option", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("renders multiple options in single group", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [
              { label: "Edit", onClick: mockOnClick },
              { label: "Duplicate", onClick: mockOnClick },
              { label: "Archive", onClick: mockOnClick },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Duplicate")).toBeInTheDocument();
    expect(screen.getByText("Archive")).toBeInTheDocument();
  });

  it("renders multiple groups", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
          {
            options: [{ label: "Delete", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Delete")).toBeInTheDocument();
  });

  it("calls onClick when option is clicked", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));
    await user.click(screen.getByText("Edit"));

    expect(mockOnClick).toHaveBeenCalledTimes(1);
  });

  it("calls correct onClick for multiple options", async () => {
    const user = userEvent.setup();
    const editClick = jest.fn();
    const deleteClick = jest.fn();

    render(
      <MoreOptions
        groups={[
          {
            options: [
              { label: "Edit", onClick: editClick },
              { label: "Delete", onClick: deleteClick },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));
    await user.click(screen.getByText("Edit"));

    expect(editClick).toHaveBeenCalledTimes(1);
    expect(deleteClick).not.toHaveBeenCalled();
  });

  it("renders disabled option with correct attributes", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick, disabled: true }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    const option = screen.getByTestId("more-options-option-0-0");
    expect(option).toHaveAttribute("data-disabled");
    expect(option).toHaveAttribute("aria-disabled", "true");
  });

  it("applies destructive styling", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [
              { label: "Delete", onClick: mockOnClick, destructive: true },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    const option = screen.getByTestId("more-options-option-0-0");
    expect(option).toHaveClass("text-destructive");
  });

  it("renders ReactNode label with icon", async () => {
    const user = userEvent.setup();
    const label = (
      <div className="flex items-center gap-2">
        <span className="icon">📝</span>
        <span>Edit</span>
      </div>
    );

    render(
      <MoreOptions
        groups={[
          {
            options: [{ label, onClick: mockOnClick }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByText("📝")).toBeInTheDocument();
    expect(screen.getByText("Edit")).toBeInTheDocument();
  });

  it("uses custom testId", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        testId="custom-more"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("custom-more-trigger")).toBeInTheDocument();

    await user.click(screen.getByTestId("custom-more-trigger"));

    expect(screen.getByTestId("custom-more-content")).toBeInTheDocument();
    expect(screen.getByTestId("custom-more-option-0-0")).toBeInTheDocument();
  });

  it("applies custom className", () => {
    render(
      <MoreOptions
        className="custom-class"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    const trigger = screen.getByTestId("more-options-trigger");
    expect(trigger).toHaveClass("custom-class");
  });

  it("generates correct testIds for multiple groups", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [
              { label: "Edit", onClick: mockOnClick },
              { label: "View", onClick: mockOnClick },
            ],
          },
          {
            options: [{ label: "Delete", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByTestId("more-options-option-0-0")).toBeInTheDocument();
    expect(screen.getByTestId("more-options-option-0-1")).toBeInTheDocument();
    expect(screen.getByTestId("more-options-option-1-0")).toBeInTheDocument();
  });

  it("renders with align start", () => {
    render(
      <MoreOptions
        align="start"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with align center", () => {
    render(
      <MoreOptions
        align="center"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with align end", () => {
    render(
      <MoreOptions
        align="end"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with side top", () => {
    render(
      <MoreOptions
        side="top"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with side bottom", () => {
    render(
      <MoreOptions
        side="bottom"
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with custom sideOffset", () => {
    render(
      <MoreOptions
        sideOffset={16}
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with custom alignOffset", () => {
    render(
      <MoreOptions
        alignOffset={-20}
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders with both disabled and destructive options", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [
              { label: "Edit", onClick: mockOnClick },
              { label: "Duplicate", onClick: mockOnClick, disabled: true },
            ],
          },
          {
            options: [
              { label: "Delete", onClick: mockOnClick, destructive: true },
            ],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    const editOption = screen.getByTestId("more-options-option-0-0");
    const duplicateOption = screen.getByTestId("more-options-option-0-1");
    const deleteOption = screen.getByTestId("more-options-option-1-0");

    expect(editOption).not.toHaveAttribute("data-disabled");
    expect(duplicateOption).toHaveAttribute("data-disabled");
    expect(deleteOption).toHaveClass("text-destructive");
  });

  it("trigger has hover styles", () => {
    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    const trigger = screen.getByTestId("more-options-trigger");
    expect(trigger).toHaveClass("hover:bg-accent");
  });

  it("trigger has cursor pointer", () => {
    render(
      <MoreOptions
        groups={[
          {
            options: [{ label: "Edit", onClick: mockOnClick }],
          },
        ]}
      />,
    );

    const trigger = screen.getByTestId("more-options-trigger");
    expect(trigger).toHaveClass("cursor-pointer");
  });

  it("renders empty groups array", () => {
    render(<MoreOptions groups={[]} />);

    expect(screen.getByTestId("more-options-trigger")).toBeInTheDocument();
  });

  it("renders group with empty options array", async () => {
    const user = userEvent.setup();

    render(
      <MoreOptions
        groups={[
          {
            options: [],
          },
        ]}
      />,
    );

    await user.click(screen.getByTestId("more-options-trigger"));

    expect(screen.getByTestId("more-options-content")).toBeInTheDocument();
  });
});
