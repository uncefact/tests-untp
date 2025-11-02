import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavMenuItem } from "./NavMenuItem";

const TestIcon = () => <svg data-testid="test-icon">Icon</svg>;

describe("NavMenuItem", () => {
  it("renders the component", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" />);

    expect(screen.getByTestId("nav-menu-item-configuration")).toBeInTheDocument();
  });

  it("renders label text", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" />);

    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("renders with URL icon", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" />);

    const icon = screen.getByTestId("nav-menu-item-configuration-icon");
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute("src", "/icons/settings.svg");
  });

  it("renders with React component icon", () => {
    render(<NavMenuItem label="Configuration" icon={<TestIcon />} />);

    const iconWrapper = screen.getByTestId("nav-menu-item-configuration-icon");
    expect(within(iconWrapper).getByTestId("test-icon")).toBeInTheDocument();
  });

  it("renders without icon", () => {
    render(<NavMenuItem label="Configuration" />);

    expect(screen.queryByTestId("nav-menu-item-configuration-icon")).not.toBeInTheDocument();
    expect(screen.getByText("Configuration")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();

    render(
      <NavMenuItem
        label="Configuration"
        icon="/icons/settings.svg"
        onClick={handleClick}
      />,
    );

    const navItem = screen.getByTestId("nav-menu-item-configuration");
    await user.click(navItem);

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("applies active styles", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" isActive />);

    const navItem = screen.getByTestId("nav-menu-item-configuration");
    expect(navItem).toHaveClass("bg-nav-item-active");
  });

  it("applies hover styles when not active", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" />);

    const navItem = screen.getByTestId("nav-menu-item-configuration");
    expect(navItem).toHaveClass("hover:bg-nav-item-hover");
  });

  it("has cursor-pointer class", () => {
    render(<NavMenuItem label="Configuration" icon="/icons/settings.svg" />);

    const navItem = screen.getByTestId("nav-menu-item-configuration");
    expect(navItem).toHaveClass("cursor-pointer");
  });

  it("renders with custom className", () => {
    render(
      <NavMenuItem
        label="Configuration"
        icon="/icons/settings.svg"
        className="custom-class"
      />,
    );

    const navItem = screen.getByTestId("nav-menu-item-configuration");
    expect(navItem).toHaveClass("custom-class");
  });

  it("renders as expandable with chevron", () => {
    render(<NavMenuItem label="Resources" icon="/icons/settings.svg" isExpandable />);

    const chevron = screen.getByTestId("nav-menu-item-resources-chevron");
    expect(chevron).toBeInTheDocument();
  });

  it("rotates chevron when expanded", () => {
    render(<NavMenuItem label="Resources" icon="/icons/settings.svg" isExpandable isExpanded />);

    const chevron = screen.getByTestId("nav-menu-item-resources-chevron");
    expect(chevron).toHaveClass("rotate-180");
  });

  it("applies sub-item padding", () => {
    render(<NavMenuItem label="Sub Item" icon="/icons/settings.svg" isSubItem />);

    const navItem = screen.getByTestId("nav-menu-item-sub-item");
    expect(navItem).toHaveClass("pl-10");
  });

  it("generates correct test id from label with spaces", () => {
    render(<NavMenuItem label="My Settings" icon="/icons/settings.svg" />);

    expect(screen.getByTestId("nav-menu-item-my-settings")).toBeInTheDocument();
  });
});
