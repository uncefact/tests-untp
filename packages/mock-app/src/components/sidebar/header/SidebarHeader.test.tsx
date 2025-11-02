import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SidebarHeader } from "./SidebarHeader";

describe("SidebarHeader", () => {
  const defaultProps = {
    logo: "/logo.png",
    onLogoClick: jest.fn(),
  };

  it("renders the component", () => {
    render(<SidebarHeader {...defaultProps} />);

    expect(screen.getByTestId("sidebar-header")).toBeInTheDocument();
  });

  it("renders logo image", () => {
    render(<SidebarHeader {...defaultProps} />);

    const logo = screen.getByTestId("sidebar-header-logo");
    expect(logo).toBeInTheDocument();
    expect(logo).toHaveAttribute("src", "/logo.png");
  });

  it("renders with custom logo", () => {
    render(<SidebarHeader {...defaultProps} logo="/custom-logo.png" />);

    const logo = screen.getByTestId("sidebar-header-logo");
    expect(logo).toHaveAttribute("src", "/custom-logo.png");
  });

  it("calls onLogoClick when logo is clicked", async () => {
    const user = userEvent.setup();
    const handleLogoClick = jest.fn();

    render(<SidebarHeader {...defaultProps} onLogoClick={handleLogoClick} />);

    const header = screen.getByTestId("sidebar-header");
    await user.click(header);

    expect(handleLogoClick).toHaveBeenCalledTimes(1);
  });

  it("renders as a button when onLogoClick is provided", () => {
    render(<SidebarHeader {...defaultProps} />);

    const header = screen.getByTestId("sidebar-header");
    expect(header.tagName).toBe("BUTTON");
  });

  it("renders with custom className", () => {
    render(<SidebarHeader {...defaultProps} className="custom-class" />);

    const logo = screen.getByTestId("sidebar-header-logo");
    expect(logo).toHaveClass("custom-class");
  });
});
