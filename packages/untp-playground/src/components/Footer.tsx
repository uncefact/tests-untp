"use client";

export function Footer() {
  return (
    <footer className="border-t mt-8">
      <div className="container mx-auto p-8 max-w-7xl">
        <div className="flex flex-col md:flex-row justify-center items-center gap-4 text-sm text-muted-foreground">
          <a
            href="https://uncefact.github.io/spec-untp/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            UNTP Specification
          </a>
          <span className="hidden md:inline">•</span>
          <a
            href="https://uncefact.github.io/tests-untp/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >
            UNTP Test Suite
          </a>
        </div>
      </div>
    </footer>
  );
}
