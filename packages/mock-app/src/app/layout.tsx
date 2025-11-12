import { SessionProvider } from "next-auth/react";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <SessionProvider>
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
