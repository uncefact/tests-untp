import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NavMenu } from "./NavMenu";
import { type NavMenuItemConfig } from "../nav-menu-item";

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
];

describe("NavMenu", () => {
  it("renders the component", () => {
    render(<NavMenu items={mockNavItems} />);

    expect(screen.getByTestId("nav-menu")).toBeInTheDocument();
  });

  it("renders all navigation items", () => {
    render(<NavMenu items={mockNavItems} />);

    expect(screen.getByText("Credentials")).toBeInTheDocument();
    expect(screen.getByText("Identifiers")).toBeInTheDocument();
    expect(screen.getByText("Master data")).toBeInTheDocument();
  });

  it("does not show sub-items initially for expandable items", () => {
    render(<NavMenu items={mockNavItems} />);

    expect(screen.queryByText("Conformity credential")).not.toBeInTheDocument();
    expect(screen.queryByText("Facility record")).not.toBeInTheDocument();
  });

  it("expands item and shows sub-items when expandable item is clicked", async () => {
    const user = userEvent.setup();
    render(<NavMenu items={mockNavItems} />);

    const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
    await user.click(credentialsItem);

    expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    expect(screen.getByText("Facility record")).toBeInTheDocument();
  });

  it("collapses item when expandable item is clicked again", async () => {
    const user = userEvent.setup();
    render(<NavMenu items={mockNavItems} />);

    const credentialsItem = screen.getByTestId("nav-menu-item-credentials");

    // Expand
    await user.click(credentialsItem);
    expect(screen.getByText("Conformity credential")).toBeInTheDocument();

    // Collapse
    await user.click(credentialsItem);
    expect(screen.queryByText("Conformity credential")).not.toBeInTheDocument();
  });

  it("calls onNavClick when non-expandable item is clicked", async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(<NavMenu items={mockNavItems} onNavClick={handleNavClick} />);

    const identifiersItem = screen.getByTestId("nav-menu-item-identifiers");
    await user.click(identifiersItem);

    expect(handleNavClick).toHaveBeenCalledWith("identifiers");
  });

  it("calls onNavClick when sub-item is clicked", async () => {
    const user = userEvent.setup();
    const handleNavClick = jest.fn();

    render(<NavMenu items={mockNavItems} onNavClick={handleNavClick} />);

    // Expand credentials
    const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
    await user.click(credentialsItem);

    // Click sub-item
    const conformityItem = screen.getByTestId("nav-menu-item-conformity-credential");
    await user.click(conformityItem);

    expect(handleNavClick).toHaveBeenCalledWith("conformity-credential");
  });

  it("auto-expands parent when sub-item is selected", () => {
    render(
      <NavMenu items={mockNavItems} selectedNavId="conformity-credential" />
    );

    // Sub-items should be visible
    expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    expect(screen.getByText("Facility record")).toBeInTheDocument();
  });

  it("shows active state on selected item", () => {
    render(<NavMenu items={mockNavItems} selectedNavId="identifiers" />);

    const identifiersItem = screen.getByTestId("nav-menu-item-identifiers");
    expect(identifiersItem).toHaveClass("bg-nav-item-active");
  });

  it("shows active state on selected sub-item", () => {
    render(<NavMenu items={mockNavItems} selectedNavId="conformity-credential" />);

    const conformityItem = screen.getByTestId("nav-menu-item-conformity-credential");
    expect(conformityItem).toHaveClass("bg-nav-item-active");
  });

  it("renders with custom className", () => {
    render(<NavMenu items={mockNavItems} className="custom-class" />);

    const nav = screen.getByTestId("nav-menu");
    expect(nav).toHaveClass("custom-class");
  });

  it("renders empty nav when items array is empty", () => {
    render(<NavMenu items={[]} />);

    expect(screen.getByTestId("nav-menu")).toBeInTheDocument();
    expect(screen.queryByTestId("nav-menu-item-credentials")).not.toBeInTheDocument();
  });

  describe("autoCollapseInactive", () => {
    it("keeps manually expanded items open when autoCollapseInactive is false", async () => {
      const user = userEvent.setup();
      render(
        <NavMenu items={mockNavItems} selectedNavId="identifiers" autoCollapseInactive={false} />
      );

      // Manually expand credentials
      const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
      await user.click(credentialsItem);

      // Sub-items should be visible
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();

      // Click on another non-expandable item
      const masterDataItem = screen.getByTestId("nav-menu-item-master-data");
      await user.click(masterDataItem);

      // Credentials should still be expanded (autoCollapseInactive is false)
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    });

    it("collapses other items when clicking a non-expandable item with autoCollapseInactive", async () => {
      const user = userEvent.setup();
      render(
        <NavMenu items={mockNavItems} autoCollapseInactive={true} />
      );

      // Manually expand credentials
      const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
      await user.click(credentialsItem);

      // Sub-items should be visible
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();

      // Click on a non-expandable item
      const masterDataItem = screen.getByTestId("nav-menu-item-master-data");
      await user.click(masterDataItem);

      // Credentials should be collapsed (autoCollapseInactive is true)
      expect(screen.queryByText("Conformity credential")).not.toBeInTheDocument();
    });

    it("allows multiple items to be expanded manually with autoCollapseInactive", async () => {
      const user = userEvent.setup();
      render(
        <NavMenu items={mockNavItems} autoCollapseInactive={true} />
      );

      // Manually expand credentials
      const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
      await user.click(credentialsItem);
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();

      // User can still manually expand another expandable item
      // (clicking expandable items doesn't trigger auto-collapse)
      await user.click(credentialsItem); // Collapse
      await user.click(credentialsItem); // Expand again
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();
    });

    it("keeps parent expanded when clicking a sub-item with autoCollapseInactive", async () => {
      const user = userEvent.setup();
      render(
        <NavMenu items={mockNavItems} autoCollapseInactive={true} />
      );

      // Expand credentials
      const credentialsItem = screen.getByTestId("nav-menu-item-credentials");
      await user.click(credentialsItem);

      // Click on a sub-item
      const conformityItem = screen.getByTestId("nav-menu-item-conformity-credential");
      await user.click(conformityItem);

      // Parent should still be expanded
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();
      expect(screen.getByText("Facility record")).toBeInTheDocument();
    });

    it("keeps parent expanded when a sub-item is selected via prop", () => {
      render(
        <NavMenu items={mockNavItems} selectedNavId="conformity-credential" autoCollapseInactive={true} />
      );

      // Parent should be auto-expanded because child is selected
      expect(screen.getByText("Conformity credential")).toBeInTheDocument();
      expect(screen.getByText("Facility record")).toBeInTheDocument();
    });
  });
});
