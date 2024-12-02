"use client";

export function Header() {
  return (
    <header className="border-b">
      <div className="container mx-auto p-8 max-w-7xl flex items-center gap-4">
        {/* <Image
          src="https://uncefact.github.io/spec-untp/img/logo.svg"
          alt="UNTP Logo"
          width={62}
          height={62}
        /> */}
        <h1 className="text-2xl font-bold">UNTP Playground</h1>
      </div>
    </header>
  );
}
