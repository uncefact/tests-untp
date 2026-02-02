import { Providers } from "@/components/Providers/Providers";
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang='en'>
      <body>
        <noscript>You need to enable JavaScript to run this app.</noscript>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
