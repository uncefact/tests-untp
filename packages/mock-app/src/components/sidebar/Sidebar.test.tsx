import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Sidebar } from "./Sidebar";
import { UserRole, type User, type NavMenuItemConfig, type MoreOptionGroup } from "@mock-app/components";

const mockUser: User = {
  name: "Cindy Reardon",
  email: "c.reardon@emailadress.com",
  roles: [UserRole.Admin],
};

const mockNavItems: NavMenuItemConfig[] = [
  {
    id: "credentials",
    label: "Credentials",
    icon: "/icons/license.svg",
    isExpandable: true,
    subItems: [
      {
        id: "conformity-credential",
        label: "Conformity credential",
        icon: "/icons/approval.svg",
      },
      {
        id: "facility-record",
        label: "Facility record",
        icon: "/icons/precision_manufacturing.svg",
      },
      {
        id: "product-passport",
        label: "Product passport",
        icon: "/icons/passport.svg",
      },
      {
        id: "traceability-event",
        label: "Traceability event",
        icon: "/icons/blur_medium.svg",
      },
    ],
  },
  {
    id: "identifiers",
    label: "Identifiers",
    icon: "/icons/admin_panel_settings.svg",
  },
  {
    id: "master-data",
    label: "Master data",
    icon: "/icons/book_ribbon.svg",
  },
  {
    id: "resources",
    label: "Resources",
    icon: "/icons/settings.svg",
    isExpandable: true,
  },
];

const mockMenuGroups: MoreOptionGroup[] = [
  {
    options: [
      {
        label: "Logout",
        onClick: jest.fn(),
      },
    ],
  },
];

const defaultProps = {
  user: mockUser,
  logo: "/logo.png",
  onLogoClick: jest.fn(),
  navItems: mockNavItems,
  menuGroups: mockMenuGroups,
  onNavClick: jest.fn(),
};

describe("Sidebar", () => {
  it("renders the component", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId("sidebar")).toBeInTheDocument();
  });

  it("renders the header", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId("sidebar-header")).toBeInTheDocument();
  });

  it("hides header when hideHeader is true", () => {
    render(<Sidebar {...defaultProps} hideHeader={true} />);

    expect(screen.queryByTestId("sidebar-header")).not.toBeInTheDocument();
  });

  it("renders navigation items", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Identifiers")).toBeInTheDocument();
    expect(screen.getByText("Master data")).toBeInTheDocument();
    expect(screen.getByText("Resources")).toBeInTheDocument();
  });

  it("renders expandable Credentials navigation with sub-items", async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    // Credentials should be expandable
    const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
    expect(credentialsItem).toBeInTheDocument();

    // Sub-items should not be visible initially
    expect(screen.queryByText("Conformity credential")).not.toBeInTheDocument();
    expect(screen.queryByText("Facility record")).not.toBeInTheDocument();

    // Click chevron to expand
    const chevron = screen.getByTestId("nav-menu-item-credentials-chevron");
    await user.click(chevron);

    // Sub-items should now be visible
    expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    expect(screen.getByText("Facility record")).toBeInTheDocument();
    expect(screen.getByText("Product passport")).toBeInTheDocument();
    expect(screen.getByText("Traceability event")).toBeInTheDocument();
  });

  it("auto-expands credentials when a credential sub-item is selected", () => {
    render(<Sidebar {...defaultProps} selectedNavId="conformity-credential" />);

    // Credentials should be auto-expanded
    expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    expect(screen.getByText("Facility record")).toBeInTheDocument();
    expect(screen.getByText("Product passport")).toBeInTheDocument();
    expect(screen.getByText("Traceability event")).toBeInTheDocument();
  });

  it("renders the user profile in footer", () => {
    render(<Sidebar {...defaultProps} />);

    expect(screen.getByTestId("sidebar-footer")).toBeInTheDocument();
  });

  it("calls onNavClick when Identifiers is clicked", async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(<Sidebar {...defaultProps} onNavClick={handleNavClick} />);

    const identifiersText = screen.getByText("Identifiers");
    await user.click(identifiersText);

    expect(handleNavClick).toHaveBeenCalledTimes(1);
    expect(handleNavClick).toHaveBeenCalledWith("identifiers");
  });

  it("calls onNavClick when credential sub-item is clicked", async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(
      <Sidebar
        {...defaultProps}
        onNavClick={handleNavClick}
        selectedNavId="credentials"
      />,
    );

    // Expand credentials first
    const chevron = screen.getByTestId("nav-menu-item-credentials-chevron");
    await user.click(chevron);

    // Click on a sub-item
    const facilityRecordText = screen.getByText("Facility record");
    await user.click(facilityRecordText);

    expect(handleNavClick).toHaveBeenCalledWith("facility-record");
  });

  it("shows selected state on navigation item when selectedNav matches", () => {
    render(<Sidebar {...defaultProps} selectedNavId="identifiers" />);

    const identifiersItem = screen.getByTestId("nav-menu-item-identifiers");
    expect(identifiersItem).toHaveClass("bg-nav-item-active");
  });

  it("shows selected state on credential sub-item when selectedNav matches", () => {
    render(<Sidebar {...defaultProps} selectedNavId="product-passport" />);

    const productPassportItem = screen.getByTestId("nav-menu-item-product-passport");
    expect(productPassportItem).toHaveClass("bg-nav-item-active");
  });

  it("renders with custom className", () => {
    render(<Sidebar {...defaultProps} className="custom-class" />);

    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar).toHaveClass("custom-class");
  });

  it("renders skeleton when isLoading is true", () => {
    render(<Sidebar {...defaultProps} isLoading={true} />);

    expect(screen.getByTestId("sidebar-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar")).not.toBeInTheDocument();
  });

  it("collapses credentials when clicking a non-expandable item with autoCollapseInactive", async () => {
    const user = userEvent.setup();
    render(
      <Sidebar {...defaultProps} selectedNavId="conformity-credential" autoCollapseInactive={true} />,
    );

    // Should be expanded initially because conformity-credential is selected
    expect(screen.getByText("Conformity credential")).toBeInTheDocument();

    // Click on a non-expandable item (identifiers)
    const identifiersText = screen.getByText("Identifiers");
    await user.click(identifiersText);

    // Should be collapsed now
    expect(
      screen.queryByText("Conformity credential"),
    ).not.toBeInTheDocument();
  });

  it("renders Resources as an expandable item", () => {
    render(<Sidebar {...defaultProps} />);

    const resourcesItem = screen.getByTestId("nav-menu-item-resources");
    expect(resourcesItem).toBeInTheDocument();
  });
});
