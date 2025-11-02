import { render, screen } from "@testing-library/react";
import { Loader } from "./Loader";

describe("Loader", () => {
  it("renders the component", () => {
    render(<Loader />);

    expect(screen.getByTestId("loader")).toBeInTheDocument();
    expect(screen.getByTestId("loader-spinner")).toBeInTheDocument();
  });

  it("renders without text by default", () => {
    render(<Loader />);

    expect(screen.queryByTestId("loader-text")).not.toBeInTheDocument();
  });

  it("renders with text when provided", () => {
    render(<Loader text="Loading data..." />);

    const text = screen.getByTestId("loader-text");
    expect(text).toBeInTheDocument();
    expect(text).toHaveTextContent("Loading data...");
  });

  it("applies custom className to container", () => {
    render(<Loader className="custom-class min-h-screen" />);

    const loader = screen.getByTestId("loader");
    expect(loader).toHaveClass("custom-class");
    expect(loader).toHaveClass("min-h-screen");
  });

  it("applies loader theme tokens to spinner and text", () => {
    render(<Loader text="Loading..." />);

    const spinner = screen.getByTestId("loader-spinner");
    const text = screen.getByTestId("loader-text");

    expect(spinner).toHaveClass("text-loader");
    expect(text).toHaveClass("text-loader-foreground");
  });
});
